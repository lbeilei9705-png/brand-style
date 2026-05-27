import type { AddConversationMessageRequest, AddConversationMessageResponse, AgentConfig, Conversation, ConversationMessage, CreateConversationRequest, CreateTaskRequest, ModelConfig } from "../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "./config.ts";
import type { ConfigStore } from "./configStore.ts";
import type { ConversationStore } from "./conversationStore.ts";
import { FintopiaImageProvider } from "./providers/fintopiaImageProvider.ts";
import type { ImageProvider } from "./providers/imageProvider.ts";
import { MockImageProvider } from "./providers/mockImageProvider.ts";
import { PromptOrchestrator } from "./pipeline/promptOrchestrator.ts";
import { TaskService } from "./taskService.ts";
import { TaskStore } from "./taskStore.ts";

function now(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function titleFromMessage(content: string): string {
  const trimmed = content.trim();

  if (!trimmed) {
    return "新对话";
  }

  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
}

function getHighestReferencedImageIndex(content: string): number {
  const matches = [...content.matchAll(/图\s*(\d+)/g)];

  return matches.reduce((max, match) => Math.max(max, Number(match[1]) || 0), 0);
}

function parseRequestedImageCount(content: string): number | undefined {
  const numericMatch = content.match(/(?:生成|生|出|做|给我)?\s*([1-4])\s*张(?:图|图片)?/);

  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  const chineseNumbers: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
  };
  const chineseMatch = content.match(/(?:生成|生|出|做|给我)?\s*([一二两三四])\s*张(?:图|图片)?/);

  return chineseMatch ? chineseNumbers[chineseMatch[1]] : undefined;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractStyleDefaultColorPrompt(systemPrompt: string): { prompt: string; colors: string[] } | undefined {
  const colorSection = systemPrompt.match(/(?:品牌色|默认配色|配色)[:：]?\s*([\s\S]*?)(?=\n\s*\n|$)/);
  const colorText = colorSection?.[1]?.trim();
  const hexColors = uniqueValues(systemPrompt.match(/#[0-9a-fA-F]{3,8}\b/g) || []);

  if (colorText) {
    return {
      prompt: colorText.replace(/\s+/g, " "),
      colors: uniqueValues(colorText.match(/#[0-9a-fA-F]{3,8}\b/g) || hexColors),
    };
  }

  if (hexColors.length >= 2) {
    return {
      prompt: `使用风格套装中定义的品牌色：${hexColors.join("、")}`,
      colors: hexColors,
    };
  }

  return undefined;
}

function isPromptSectionHeading(line: string, headings: string[]): boolean {
  const normalized = line.trim().replace(/\s+/g, "");

  return headings.some((heading) => {
    const normalizedHeading = heading.replace(/\s+/g, "");

    return normalized === normalizedHeading
      || normalized.startsWith(`${normalizedHeading}:`)
      || normalized.startsWith(`${normalizedHeading}：`);
  });
}

function removePromptSections(systemPrompt: string, targetHeadings: string[]): string {
  if (!targetHeadings.length) {
    return systemPrompt;
  }

  const sectionHeadings = [
    "渲染",
    "渲染方式",
    "材质",
    "材质库",
    "品牌色",
    "默认配色",
    "配色",
    "形状",
    "造型",
    "负面词",
    "负面提示词",
  ];
  const lines = systemPrompt.split("\n");
  const result: string[] = [];
  let isRemoving = false;

  for (const line of lines) {
    if (isPromptSectionHeading(line, targetHeadings)) {
      isRemoving = true;
      continue;
    }

    if (isRemoving) {
      if (line.trim() && isPromptSectionHeading(line, sectionHeadings)) {
        isRemoving = false;
      } else {
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanAgentSystemPrompt(systemPrompt: string, options: { hasManualPalette: boolean; hasManualMaterials: boolean }): string {
  return removePromptSections(systemPrompt, [
    ...(options.hasManualPalette ? ["品牌色", "默认配色", "配色"] : []),
    ...(options.hasManualMaterials ? ["材质", "材质库"] : []),
  ]);
}

export class ConversationService {
  private readonly conversationStore: ConversationStore;
  private readonly configStore: ConfigStore;
  private readonly taskStore: TaskStore;
  private readonly fintopiaConfig?: FintopiaConfig;

  constructor(
    conversationStore: ConversationStore,
    configStore: ConfigStore,
    taskStore: TaskStore,
    fintopiaConfig?: FintopiaConfig,
  ) {
    this.conversationStore = conversationStore;
    this.configStore = configStore;
    this.taskStore = taskStore;
    this.fintopiaConfig = fintopiaConfig;
  }

  list(): Conversation[] {
    return this.conversationStore.list();
  }

  get(conversationId: string): Conversation | undefined {
    return this.conversationStore.get(conversationId);
  }

  create(request: CreateConversationRequest): Conversation {
    const timestamp = now();
    const conversation: Conversation = {
      id: makeId("conv"),
      title: request.title || "新对话",
      modelId: request.modelId,
      agentId: request.agentId,
      messages: [],
      taskIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.conversationStore.save(conversation);
  }

  async addMessage(conversationId: string, request: AddConversationMessageRequest): Promise<AddConversationMessageResponse> {
    const conversation = this.conversationStore.get(conversationId);

    if (!conversation) {
      throw new Error("Conversation not found.");
    }

    const model = this.getModel(request.modelId);
    const agent = this.getAgent(request.agentId);
    const selectionAssets = request.selectionAssets.map((asset, index) => ({
      ...asset,
      referenceLabel: asset.referenceLabel || `图${index + 1}`,
    }));
    const highestReferencedImageIndex = getHighestReferencedImageIndex(request.content);

    if (highestReferencedImageIndex > selectionAssets.length) {
      throw new Error(`你提到了图${highestReferencedImageIndex}，但当前只添加了 ${selectionAssets.length} 张参考图。请先在 Figma 中选中对应图片，并点击“添加选中图”。`);
    }

    const primaryAsset = selectionAssets[0] || {
      id: "text-only",
      referenceLabel: "图1",
      name: "纯文案输入",
      filename: "text-prompt.txt",
      mimeType: "text/plain",
      sizeBytes: new TextEncoder().encode(request.content).length,
    };

    const requestedBatchSize = parseRequestedImageCount(request.content) || Number(request.batchSize) || 4;
    const batchSize = Math.min(4, Math.max(1, requestedBatchSize));
    const materialPresetIds = request.materialPresetIds?.length
      ? request.materialPresetIds
      : request.materialPresetId
        ? [request.materialPresetId]
        : [];
    const materials = this.configStore.listMaterials()
      .filter((item) => materialPresetIds.includes(item.id) && item.enabled);
    const colorPalette = request.colorPaletteId
      ? this.configStore.listColorPalettes().find((item) => item.id === request.colorPaletteId && item.enabled)
      : undefined;
    const styleDefaultColor = colorPalette ? undefined : extractStyleDefaultColorPrompt(agent.systemPrompt);
    const activeColorPrompt = colorPalette
      ? `手动配色方案「${colorPalette.name}」：${colorPalette.prompt} 色值：${colorPalette.colors.join("、")}`
      : styleDefaultColor
        ? `风格套装默认配色「${agent.name}」：${styleDefaultColor.prompt}${styleDefaultColor.colors.length ? ` 色值：${styleDefaultColor.colors.join("、")}` : ""}`
        : undefined;
    const cleanedAgentSystemPrompt = cleanAgentSystemPrompt(agent.systemPrompt, {
      hasManualPalette: Boolean(colorPalette),
      hasManualMaterials: materials.length > 0,
    });
    const shapeArchitecture = request.shapeArchitectureId
      ? this.configStore.listShapeArchitectures().find((item) => item.id === request.shapeArchitectureId && item.enabled)
      : undefined;
    const primaryAssetWidth = "width" in primaryAsset ? primaryAsset.width : undefined;
    const primaryAssetHeight = "height" in primaryAsset ? primaryAsset.height : undefined;
    const taskRequest: CreateTaskRequest = {
      inputType: request.inputType,
      stylePresetId: agent.defaultStylePresetId,
      source: "figma_selection",
      filename: primaryAsset.filename,
      mimeType: primaryAsset.mimeType,
      sizeBytes: primaryAsset.sizeBytes,
      assetDataUrl: primaryAsset.assetDataUrl,
      referenceAssets: selectionAssets,
      userMessage: request.content,
      agentSystemPrompt: cleanedAgentSystemPrompt,
      materialPrompt: materials.length
        ? materials.map((material) => `材质球「${material.name}」：${material.prompt}`).join("；")
        : undefined,
      colorPrompt: activeColorPrompt,
      shapeArchitecturePrompt: shapeArchitecture ? `形状「${shapeArchitecture.name}」：${shapeArchitecture.prompt}` : undefined,
      extraNegativeRules: agent.defaultNegativeRules,
      usePromptOrchestrator: request.usePromptOrchestrator !== false,
      orchestrationContext: {
        selectedImage: {
          referenceLabel: primaryAsset.referenceLabel,
          filename: primaryAsset.filename,
          mimeType: primaryAsset.mimeType,
          width: primaryAssetWidth,
          height: primaryAssetHeight,
          sizeBytes: primaryAsset.sizeBytes,
        },
        selectedImages: selectionAssets.map((asset, index) => ({
          referenceLabel: asset.referenceLabel || `图${index + 1}`,
          filename: asset.filename,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          sizeBytes: asset.sizeBytes,
        })),
        styleSkill: {
          name: agent.name,
          description: agent.description,
          systemPrompt: cleanedAgentSystemPrompt,
        },
        materials: materials.map((material) => ({
          name: material.name,
          description: material.description,
          prompt: material.prompt,
        })),
        colorPalette: colorPalette
          ? {
            name: colorPalette.name,
            description: colorPalette.description,
            colors: colorPalette.colors,
            prompt: colorPalette.prompt,
          }
          : styleDefaultColor
            ? {
              name: `${agent.name} 默认配色`,
              description: "来自风格套装的默认配色；仅在用户未手动选择配色时启用。",
              colors: styleDefaultColor.colors,
              prompt: styleDefaultColor.prompt,
            }
            : undefined,
        shapeArchitecture: shapeArchitecture
          ? {
            name: shapeArchitecture.name,
            description: shapeArchitecture.description,
            prompt: shapeArchitecture.prompt,
          }
          : undefined,
      },
      constraints: {
        preserveStructure: true,
        styleLock: true,
        transparentBackground: true,
        fidelityLevel: "balanced",
        variationStrength: "medium",
        batchSize,
        aspectRatio: request.aspectRatio || "1:1",
        resolution: request.resolution || "2k",
      },
      target: "figma",
    };
    let activeModel = model;
    let fallbackReason = "";
    let taskResponse: Awaited<ReturnType<TaskService["createTask"]>>;

    try {
      const taskService = new TaskService(this.taskStore, this.createProvider(model), this.createPromptOrchestrator());
      taskResponse = await taskService.createTask(taskRequest);
    } catch (error) {
      const fallbackModel = this.getFallbackModel(model);

      if (!fallbackModel) {
        throw error;
      }

      fallbackReason = error instanceof Error ? error.message : "当前模型调用失败。";
      activeModel = fallbackModel;
      const fallbackTaskService = new TaskService(this.taskStore, this.createProvider(fallbackModel), this.createPromptOrchestrator());

      try {
        taskResponse = await fallbackTaskService.createTask(taskRequest);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "备用模型调用失败。";
        throw new Error(`当前模型「${model.name}」调用失败：${fallbackReason} 备用模型「${fallbackModel.name}」也失败：${fallbackMessage}`);
      }
    }
    const timestamp = now();
    const userMessage: ConversationMessage = {
      id: makeId("msg"),
      role: "user",
      content: request.content,
      createdAt: timestamp,
      selectionAssets,
    };
    const assistantMessage: ConversationMessage = {
      id: makeId("msg"),
      role: "assistant",
      content: fallbackReason
        ? `「${model.name}」长时间未返回，已自动改用「${activeModel.name}」生成 ${taskResponse.task.results.length} 张图片。`
        : `已使用「${agent.name}」和「${activeModel.name}」生成 ${taskResponse.task.results.length} 张图片。`,
      createdAt: timestamp,
      taskId: taskResponse.taskId,
      resultIds: taskResponse.task.results.map((result) => result.id),
    };
    const updated: Conversation = {
      ...conversation,
      title: conversation.messages.length ? conversation.title : titleFromMessage(request.content),
      modelId: activeModel.id,
      agentId: request.agentId,
      messages: [...conversation.messages, userMessage, assistantMessage],
      taskIds: [...conversation.taskIds, taskResponse.taskId],
      updatedAt: timestamp,
    };

    this.conversationStore.save(updated);

    return {
      conversation: updated,
      task: taskResponse.task,
    };
  }

  private getModel(modelId: string): ModelConfig {
    const model = this.configStore.listModels().find((item) => item.id === modelId && item.enabled && (item.purpose || "image") === "image");

    if (!model) {
      throw new Error("生图模型配置不存在或已停用。");
    }

    return model;
  }

  private getAgent(agentId: string): AgentConfig {
    if (!agentId) {
      const timestamp = now();

      return {
        id: "",
        name: "未选择风格 Skill",
        description: "不叠加后台风格 Skill，仅使用本轮输入和参考图。",
        systemPrompt: "",
        defaultStylePresetId: "",
        defaultNegativeRules: [],
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }

    const agent = this.configStore.listAgents().find((item) => item.id === agentId && item.enabled);

    if (!agent) {
      throw new Error("风格 Skill 配置不存在或已停用。");
    }

    return agent;
  }

  private getFallbackModel(model: ModelConfig): ModelConfig | undefined {
    if (model.provider !== "fintopia" || model.apiPath?.includes("/chat/completions")) {
      return undefined;
    }

    return this.configStore.listModels().find((item) => (
      item.id !== model.id
      && item.enabled
      && item.provider === "fintopia"
      && Boolean(item.apiPath?.includes("/chat/completions"))
    ));
  }

  private createProvider(model: ModelConfig): ImageProvider {
    if (model.provider === "fintopia") {
      return new FintopiaImageProvider({
        apiUrl: model.apiUrl || this.fintopiaConfig?.apiUrl || "",
        apiKey: model.apiKey || this.fintopiaConfig?.apiKey || "",
        model: model.model,
        version: model.apiVersion || this.fintopiaConfig?.version || "",
        apiStyle: model.apiStyle || this.fintopiaConfig?.apiStyle || "azure",
        apiPath: model.apiPath || this.fintopiaConfig?.apiPath || "",
      });
    }

    return new MockImageProvider();
  }

  private createPromptOrchestrator(): PromptOrchestrator | undefined {
    const model = this.configStore.listModels().find((item) => (
      item.enabled
      && item.provider === "fintopia"
      && item.purpose === "language"
    ));

    if (!model) {
      return undefined;
    }

    return new PromptOrchestrator(model, this.fintopiaConfig);
  }
}
