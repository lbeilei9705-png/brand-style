import type { AddConversationMessageRequest, AddConversationMessageResponse, AgentConfig, Conversation, ConversationMessage, CreateConversationRequest, CreateTaskRequest, ModelConfig } from "../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "./config.ts";
import type { ConfigStore } from "./configStore.ts";
import type { ConversationStore } from "./conversationStore.ts";
import { applyPriorityDedupeToStylePrompt, getHighestReferencedImageIndex, makeId, now, parseRequestedImageCount, titleFromMessage } from "./conversationUtils.ts";
import { PromptOrchestrator } from "./pipeline/promptOrchestrator.ts";
import { FintopiaImageProvider } from "./providers/fintopiaImageProvider.ts";
import type { ImageProvider } from "./providers/imageProvider.ts";
import { MockImageProvider } from "./providers/mockImageProvider.ts";
import { TaskService } from "./taskService.ts";
import { TaskStore } from "./taskStore.ts";

export class ConversationGenerationService {
  protected readonly conversationStore: ConversationStore;
  protected readonly configStore: ConfigStore;
  protected readonly taskStore: TaskStore;
  protected readonly fintopiaConfig?: FintopiaConfig;

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

    const selectedBatchSize = Number(request.batchSize) || 1;
    const requestedBatchSize = selectedBatchSize > 1
      ? selectedBatchSize
      : parseRequestedImageCount(request.content) || selectedBatchSize;
    const batchSize = Math.min(4, Math.max(1, requestedBatchSize));
    const materialPresetIds = request.materialPresetIds?.length
      ? request.materialPresetIds
      : request.materialPresetId
        ? [request.materialPresetId]
        : [];
    const materials = this.configStore.listMaterials()
      .filter((item) => materialPresetIds.includes(item.id) && item.enabled);
    const configuredColorPalette = request.colorPaletteId
      ? this.configStore.listColorPalettes().find((item) => item.id === request.colorPaletteId && item.enabled)
      : undefined;
    const customColorPalette = request.customColorPalette?.colors?.length
      ? {
        id: "custom-color-palette",
        name: request.customColorPalette.name || "本次自定义配色",
        description: request.customColorPalette.description || "来自插件前台临时调色",
        colors: request.customColorPalette.colors,
        prompt: request.customColorPalette.prompt,
        enabled: true,
        createdAt: "",
        updatedAt: "",
      }
      : undefined;
    const colorPalette = customColorPalette || configuredColorPalette;
    const isOriginalColorPalette = Boolean(colorPalette?.name.includes("原图色彩"));
    const activeColorPrompt = colorPalette
      ? isOriginalColorPalette
        ? colorPalette.prompt || "保持参考图原有色彩关系，不按品牌预设中的颜色描述改色。"
        : colorPalette.prompt
      : undefined;
    const shapeArchitecture = request.shapeArchitectureId
      ? this.configStore.listShapeArchitectures().find((item) => item.id === request.shapeArchitectureId && item.enabled)
      : undefined;
    const operationScenario = request.operationScenarioId
      ? this.configStore.listOperationScenarios().find((item) => item.id === request.operationScenarioId && item.enabled)
      : undefined;
    const hasGenerationConfig = Boolean(agent.id || materials.length || colorPalette || shapeArchitecture || operationScenario);
    const dedupedStylePrompt = applyPriorityDedupeToStylePrompt(agent.systemPrompt, {
      hasManualPalette: Boolean(colorPalette),
      hasManualMaterials: materials.length > 0,
      hasManualShape: Boolean(shapeArchitecture),
    });
    const agentSystemPromptForGeneration = dedupedStylePrompt.prompt;
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
      directPrompt: request.directPrompt,
      agentSystemPrompt: operationScenario ? undefined : agentSystemPromptForGeneration,
      materialPrompt: !operationScenario && materials.length
        ? materials.map((material) => `材质球「${material.name}」：${material.prompt}`).join("；")
        : undefined,
      colorPrompt: operationScenario ? undefined : activeColorPrompt,
      shapeArchitecturePrompt: !operationScenario && shapeArchitecture ? `形状「${shapeArchitecture.name}」：${shapeArchitecture.prompt}` : undefined,
      operationScenarioPrompt: operationScenario
        ? {
          name: operationScenario.name,
          fixedPrompt: operationScenario.fixedPrompt || operationScenario.content || "",
          variablePrompt: request.content.trim() || operationScenario.variablePrompt || operationScenario.content || "",
          negativeRules: agent.defaultNegativeRules,
        }
        : undefined,
      extraNegativeRules: operationScenario || !hasGenerationConfig ? [] : agent.defaultNegativeRules,
      usePromptOrchestrator: hasGenerationConfig && !operationScenario && request.usePromptOrchestrator !== false,
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
          systemPrompt: agentSystemPromptForGeneration,
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
    const latestConversation = this.conversationStore.get(conversationId);

    if (!latestConversation) {
      throw new Error("Conversation expired while generation was running.");
    }

    const updated: Conversation = {
      ...latestConversation,
      title: latestConversation.messages.length ? latestConversation.title : titleFromMessage(request.content),
      modelId: activeModel.id,
      agentId: request.agentId,
      messages: [...latestConversation.messages, userMessage, assistantMessage],
      taskIds: [...latestConversation.taskIds, taskResponse.taskId],
      updatedAt: timestamp,
    };

    this.conversationStore.save(updated);

    return {
      conversation: updated,
      task: taskResponse.task,
    };
  }

  protected getModel(modelId: string): ModelConfig {
    const model = this.configStore.listModels().find((item) => item.id === modelId && item.enabled && (item.purpose || "image") === "image");

    if (!model) {
      throw new Error("生图模型配置不存在或已停用。");
    }

    return model;
  }

  protected getAgent(agentId: string): AgentConfig {
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

  protected getFallbackModel(model: ModelConfig): ModelConfig | undefined {
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

  protected createProvider(model: ModelConfig): ImageProvider {
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

  protected createPromptOrchestrator(): PromptOrchestrator | undefined {
    const model = this.getLanguageModel();

    if (!model) {
      return undefined;
    }

    return new PromptOrchestrator(model, this.fintopiaConfig);
  }

  protected getLanguageModel(modelId?: string): ModelConfig | undefined {
    if (modelId) {
      const model = this.configStore.listModels().find((item) => item.id === modelId && item.enabled && item.purpose === "language");

      if (model) {
        return model;
      }
    }

    const enabledLanguageModels = this.configStore.listModels().filter((item) => (
      item.enabled
      && item.provider === "fintopia"
      && item.purpose === "language"
    ));

    return enabledLanguageModels.find((item) => item.id === "gemini-3-1-pro")
      || enabledLanguageModels[0];
  }
}
