import type { AddConversationMessageRequest, AddConversationMessageResponse, AgentConfig, Conversation, ConversationMessage, CreateConversationRequest, CreateTaskRequest, ModelConfig } from "../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "./config.ts";
import type { ConfigStore } from "./configStore.ts";
import type { ConversationStore } from "./conversationStore.ts";
import { FintopiaImageProvider } from "./providers/fintopiaImageProvider.ts";
import type { ImageProvider } from "./providers/imageProvider.ts";
import { MockImageProvider } from "./providers/mockImageProvider.ts";
import { PromptOrchestrator } from "./pipeline/promptOrchestrator.ts";
import { parseScenarioAgentTrigger, runScenarioAgent, type ScenarioAgentDebugResult } from "./pipeline/scenarioAgentService.ts";
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

function isPromptSectionHeading(line: string, headings: string[]): boolean {
  const normalized = line.trim().replace(/\s+/g, "");

  return headings.some((heading) => {
    const normalizedHeading = heading.replace(/\s+/g, "");

    return normalized === normalizedHeading
      || normalized.startsWith(`${normalizedHeading}:`)
      || normalized.startsWith(`${normalizedHeading}：`);
  });
}

type RemovedLowPrioritySegment = {
  source: "styleSkill";
  reason: "manualColorPalette" | "manualMaterials" | "manualShape";
  heading: string;
  content: string;
};

type PromptSectionTarget = {
  heading: string;
  reason: RemovedLowPrioritySegment["reason"];
};

function matchPromptSectionTarget(line: string, targets: PromptSectionTarget[]): PromptSectionTarget | undefined {
  const normalized = line.trim().replace(/\s+/g, "");

  return targets.find((target) => {
    const normalizedHeading = target.heading.replace(/\s+/g, "");

    return normalized === normalizedHeading
      || normalized.startsWith(`${normalizedHeading}:`)
      || normalized.startsWith(`${normalizedHeading}：`);
  });
}

function removePromptSections(systemPrompt: string, targets: PromptSectionTarget[]): {
  prompt: string;
  removedLowPrioritySegments: RemovedLowPrioritySegment[];
} {
  const targetHeadings = targets.map((target) => target.heading);

  if (!targetHeadings.length) {
    return { prompt: systemPrompt, removedLowPrioritySegments: [] };
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
  const removedLowPrioritySegments: RemovedLowPrioritySegment[] = [];
  let isRemoving = false;
  let removingTarget: PromptSectionTarget | undefined;
  let removedLines: string[] = [];

  const flushRemovedSegment = () => {
    if (!removingTarget || !removedLines.length) {
      return;
    }

    removedLowPrioritySegments.push({
      source: "styleSkill",
      reason: removingTarget.reason,
      heading: removingTarget.heading,
      content: removedLines.join("\n").trim(),
    });
    removingTarget = undefined;
    removedLines = [];
  };

  for (const line of lines) {
    const nextTarget = matchPromptSectionTarget(line, targets);

    if (!isRemoving && nextTarget) {
      isRemoving = true;
      removingTarget = nextTarget;
      removedLines = [line];
      continue;
    }

    if (isRemoving) {
      if (line.trim() && isPromptSectionHeading(line, sectionHeadings)) {
        flushRemovedSegment();

        if (nextTarget) {
          removingTarget = nextTarget;
          removedLines = [line];
          continue;
        }

        isRemoving = false;
      } else {
        removedLines.push(line);
        continue;
      }
    }

    result.push(line);
  }

  flushRemovedSegment();

  return {
    prompt: result.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removedLowPrioritySegments,
  };
}

function applyPriorityDedupeToStylePrompt(
  systemPrompt: string,
  options: { hasManualPalette: boolean; hasManualMaterials: boolean; hasManualShape: boolean },
): {
  prompt: string;
  removedLowPrioritySegments: RemovedLowPrioritySegment[];
} {
  return removePromptSections(systemPrompt, [
    ...(options.hasManualPalette ? [
      { heading: "品牌色", reason: "manualColorPalette" as const },
      { heading: "默认配色", reason: "manualColorPalette" as const },
      { heading: "配色", reason: "manualColorPalette" as const },
    ] : []),
    ...(options.hasManualMaterials ? [
      { heading: "材质", reason: "manualMaterials" as const },
      { heading: "材质库", reason: "manualMaterials" as const },
    ] : []),
    ...(options.hasManualShape ? [
      { heading: "形状", reason: "manualShape" as const },
      { heading: "造型", reason: "manualShape" as const },
    ] : []),
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
    const isOriginalColorPalette = Boolean(colorPalette?.name.includes("原图色彩"));
    const activeColorPrompt = colorPalette
      ? isOriginalColorPalette
        ? `手动配色方案「${colorPalette.name}」：${colorPalette.prompt || "保持参考图原有色彩关系，不按风格套装中的颜色描述改色。"}`
        : `手动配色方案「${colorPalette.name}」：${colorPalette.prompt} 色值：${colorPalette.colors.join("、")}`
      : undefined;
    const shapeArchitecture = request.shapeArchitectureId
      ? this.configStore.listShapeArchitectures().find((item) => item.id === request.shapeArchitectureId && item.enabled)
      : undefined;
    const operationScenario = request.operationScenarioId
      ? this.configStore.listOperationScenarios().find((item) => item.id === request.operationScenarioId && item.enabled)
      : undefined;
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
        }
        : undefined,
      extraNegativeRules: operationScenario ? [] : agent.defaultNegativeRules,
      usePromptOrchestrator: operationScenario ? false : request.usePromptOrchestrator !== false,
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

  async previewPrompt(request: AddConversationMessageRequest): Promise<{
    resolvedConfig: Record<string, unknown>;
    positivePrompt: string;
    negativePrompt: string;
    removedLowPrioritySegments: RemovedLowPrioritySegment[];
    finalModelPayload: Record<string, unknown>;
    scenarioAgent?: ScenarioAgentDebugResult;
    promptOrchestratorError?: string;
  }> {
    const model = this.getModel(request.modelId);
    const agent = this.getAgent(request.agentId);
    const selectionAssets = (request.selectionAssets || []).map((asset, index) => ({
      ...asset,
      referenceLabel: asset.referenceLabel || `图${index + 1}`,
    }));
    const highestReferencedImageIndex = getHighestReferencedImageIndex(request.content);

    if (highestReferencedImageIndex > selectionAssets.length) {
      throw new Error(`你提到了图${highestReferencedImageIndex}，但当前只添加了 ${selectionAssets.length} 张参考图。`);
    }
    const scenarioAgents = this.configStore.listScenarioAgents();
    const scenarioAgentConfig = parseScenarioAgentTrigger(request.content, scenarioAgents)?.agent;
    const languageModel = this.getLanguageModel(scenarioAgentConfig?.driverModelId);
    const scenarioAgent = await runScenarioAgent({
      content: request.content,
      selectionAssets,
      model: languageModel,
      fallbackConfig: this.fintopiaConfig,
      scenarioAgents,
    });

    if (scenarioAgent.isScenarioAgentApplied) {
      return {
        resolvedConfig: {
          model: { id: model.id, name: model.name, provider: model.provider },
          languageModel: languageModel
            ? { id: languageModel.id, name: languageModel.name, provider: languageModel.provider }
            : undefined,
          styleSkill: { id: agent.id, name: agent.name },
          usePromptOrchestrator: false,
          referenceImageCount: selectionAssets.length,
          scenarioAgentMode: true,
        },
        positivePrompt: "",
        negativePrompt: "",
        removedLowPrioritySegments: [],
        finalModelPayload: {
          scenarioAgentOnly: true,
          message: "场景智能体模式只生成 Prompt，不运行普通 prompt 拼装，也不调用真实生图。",
        },
        scenarioAgent,
      };
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
    const isOriginalColorPalette = Boolean(colorPalette?.name.includes("原图色彩"));
    const activeColorPrompt = colorPalette
      ? isOriginalColorPalette
        ? `手动配色方案「${colorPalette.name}」：${colorPalette.prompt || "保持参考图原有色彩关系，不按风格套装中的颜色描述改色。"}`
        : `手动配色方案「${colorPalette.name}」：${colorPalette.prompt} 色值：${colorPalette.colors.join("、")}`
      : undefined;
    const shapeArchitecture = request.shapeArchitectureId
      ? this.configStore.listShapeArchitectures().find((item) => item.id === request.shapeArchitectureId && item.enabled)
      : undefined;
    const operationScenario = request.operationScenarioId
      ? this.configStore.listOperationScenarios().find((item) => item.id === request.operationScenarioId && item.enabled)
      : undefined;
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
        }
        : undefined,
      extraNegativeRules: operationScenario ? [] : agent.defaultNegativeRules,
      usePromptOrchestrator: operationScenario ? false : request.usePromptOrchestrator !== false,
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
    const previewService = new TaskService(this.taskStore, new MockImageProvider(), this.createPromptOrchestrator());
    const preview = await previewService.previewPrompt(taskRequest);
    const stripAssetData = (asset: Record<string, unknown>) => {
      const { dataUrl, ...safeAsset } = asset;

      return { ...safeAsset, hasDataUrl: Boolean(dataUrl) };
    };

    return {
      resolvedConfig: {
        model: { id: model.id, name: model.name, provider: model.provider },
        styleSkill: { id: agent.id, name: agent.name },
        materials: materials.map((material) => ({ id: material.id, name: material.name })),
        colorPalette: colorPalette ? { id: colorPalette.id, name: colorPalette.name } : undefined,
        shapeArchitecture: shapeArchitecture ? { id: shapeArchitecture.id, name: shapeArchitecture.name } : undefined,
        operationScenario: operationScenario ? { id: operationScenario.id, name: operationScenario.name } : undefined,
        usePromptOrchestrator: taskRequest.usePromptOrchestrator,
        referenceImageCount: selectionAssets.length,
        batchSize,
      },
      positivePrompt: preview.providerRequest.prompt.positive,
      negativePrompt: preview.providerRequest.prompt.negative,
      removedLowPrioritySegments: operationScenario ? [] : dedupedStylePrompt.removedLowPrioritySegments,
      finalModelPayload: {
        ...preview.providerRequest,
        inputAsset: stripAssetData(preview.providerRequest.inputAsset as unknown as Record<string, unknown>),
        referenceAssets: preview.providerRequest.referenceAssets?.map((asset) => stripAssetData(asset as unknown as Record<string, unknown>)),
      },
      scenarioAgent,
      promptOrchestratorError: preview.promptOrchestratorError,
    };
  }

  async completeScenarioAgent(request: {
    content: string;
    selectionAssets?: AddConversationMessageRequest["selectionAssets"];
  }): Promise<{
    scenarioAgent: ScenarioAgentDebugResult;
    prompt: string;
    promptNegative?: string;
  }> {
    const selectionAssets = (request.selectionAssets || []).map((asset, index) => ({
      ...asset,
      referenceLabel: asset.referenceLabel || `图${index + 1}`,
    }));
    const highestReferencedImageIndex = getHighestReferencedImageIndex(request.content);

    if (highestReferencedImageIndex > selectionAssets.length) {
      throw new Error(`你提到了图${highestReferencedImageIndex}，但当前只添加了 ${selectionAssets.length} 张参考图。`);
    }

    const scenarioAgents = this.configStore.listScenarioAgents();
    const scenarioAgentConfig = parseScenarioAgentTrigger(request.content, scenarioAgents)?.agent;
    const scenarioAgent = await runScenarioAgent({
      content: request.content,
      selectionAssets,
      model: this.getLanguageModel(scenarioAgentConfig?.driverModelId),
      fallbackConfig: this.fintopiaConfig,
      scenarioAgents,
    });

    if (!scenarioAgent.isScenarioAgentApplied) {
      throw new Error("没有识别到场景智能体，请先用 /微缩世界 或 /单体舞台 触发。");
    }

    if (scenarioAgent.error) {
      throw new Error(scenarioAgent.error);
    }

    const prompt = scenarioAgent.promptMain || scenarioAgent.rawOutput || "";

    if (!prompt.trim()) {
      throw new Error("场景智能体没有返回可用 Prompt。");
    }

    return {
      scenarioAgent,
      prompt,
      promptNegative: scenarioAgent.promptNegative,
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
    const model = this.getLanguageModel();

    if (!model) {
      return undefined;
    }

    return new PromptOrchestrator(model, this.fintopiaConfig);
  }

  private getLanguageModel(modelId?: string): ModelConfig | undefined {
    if (modelId) {
      const model = this.configStore.listModels().find((item) => item.id === modelId && item.enabled && item.purpose === "language");

      if (model) {
        return model;
      }
    }

    return this.configStore.listModels().find((item) => (
      item.enabled
      && item.provider === "fintopia"
      && item.purpose === "language"
    ));
  }
}
