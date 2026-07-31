import type { AddConversationMessageRequest, CreateTaskRequest } from "../../../packages/shared/src/index.ts";
import { ConversationGenerationService } from "./conversationGenerationService.ts";
import { applyPriorityDedupeToStylePrompt, getHighestReferencedImageIndex, parseRequestedImageCount, stripFixedPositiveFromScenarioPrompt, stripPromptLabel, type RemovedLowPrioritySegment } from "./conversationUtils.ts";
import { parseScenarioAgentTrigger, runScenarioAgent, type ScenarioAgentDebugResult } from "./pipeline/scenarioAgentService.ts";
import { MockImageProvider } from "./providers/mockImageProvider.ts";
import { TaskService } from "./taskService.ts";

export class ConversationService extends ConversationGenerationService {
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
    const scenarioAgentCases = this.configStore.listScenarioAgentCases();
    const scenarioAgent = await runScenarioAgent({
      content: request.content,
      selectionAssets,
      model: languageModel,
      fallbackConfig: this.fintopiaConfig,
      scenarioAgents,
      scenarioAgentCases,
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
    const semanticPlan = request.semanticPlanId
      ? scenarioAgents.find((item) => item.id === request.semanticPlanId && item.enabled && item.mergeWithStyleConfig)
      : undefined;
    const semanticFixedPositivePrompt = semanticPlan
      ? request.semanticFixedPositivePrompt?.trim().slice(0, 2_000)
      : undefined;
    const semanticNegativePrompt = semanticPlan ? request.semanticNegativePrompt?.trim().slice(0, 1_000) : undefined;
    const operationScenario = !semanticPlan && request.operationScenarioId
      ? this.configStore.listOperationScenarios().find((item) => item.id === request.operationScenarioId && item.enabled)
      : undefined;
    const hasGenerationConfig = Boolean(
      agent.id || materials.length || colorPalette || shapeArchitecture || operationScenario || semanticPlan,
    );
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
      userMessage: [semanticFixedPositivePrompt, request.content].filter(Boolean).join("\n\n"),
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
      extraNegativeRules: [
        ...(operationScenario || !hasGenerationConfig ? [] : agent.defaultNegativeRules),
        ...(semanticNegativePrompt ? [semanticNegativePrompt] : []),
      ],
      semanticPlanning: Boolean(semanticPlan),
      usePromptOrchestrator: hasGenerationConfig && !operationScenario && request.usePromptOrchestrator !== false,
      orchestrationContext: {
        selectedImage: selectionAssets.length
          ? {
            referenceLabel: primaryAsset.referenceLabel,
            filename: primaryAsset.filename,
            mimeType: primaryAsset.mimeType,
            width: primaryAssetWidth,
            height: primaryAssetHeight,
            sizeBytes: primaryAsset.sizeBytes,
          }
          : undefined,
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
        semanticPlan: semanticPlan ? { id: semanticPlan.id, name: semanticPlan.name } : undefined,
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
        referenceAssets: preview.providerRequest.referenceAssets
          ?.filter((asset) => asset.mimeType.startsWith("image/"))
          .map((asset) => stripAssetData(asset as unknown as Record<string, unknown>)),
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
    promptFixedPositive?: string;
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
      scenarioAgentCases: this.configStore.listScenarioAgentCases(),
    });

    if (!scenarioAgent.isScenarioAgentApplied) {
      throw new Error("没有识别到场景智能体，请先输入一个可用的 /Skill 触发词。");
    }

    if (scenarioAgent.error) {
      throw new Error(scenarioAgent.error);
    }

    const rawPrompt = scenarioAgent.promptMain || scenarioAgent.rawOutput || "";
    const promptFixedPositive = stripPromptLabel(scenarioAgentConfig?.fixedPositivePrompt?.trim() || "");
    const prompt = stripFixedPositiveFromScenarioPrompt(rawPrompt, promptFixedPositive);

    if (!prompt.trim()) {
      throw new Error("场景智能体没有返回可用 Prompt。");
    }

    const fixedNegativePrompt = stripPromptLabel(scenarioAgentConfig?.fixedNegativePrompt?.trim() || "");
    const promptNegative = fixedNegativePrompt || scenarioAgent.promptNegative;

    return {
      scenarioAgent,
      prompt,
      promptFixedPositive,
      promptNegative,
    };
  }

}
