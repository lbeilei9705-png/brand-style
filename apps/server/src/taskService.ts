import type { AspectRatio, CreateTaskRequest, CreateTaskResponse, GeneratedImage, GenerationConstraints, GenerationResult, GenerationTask, GenerateImageRequest, OutputResolution } from "../../../packages/shared/src/index.ts";
import { parseInputAsset, parseReferenceAssets } from "./pipeline/inputParser.ts";
import { preprocessInput } from "./pipeline/preprocessor.ts";
import { buildPromptBundle } from "./pipeline/promptBuilder.ts";
import type { PromptOrchestrator } from "./pipeline/promptOrchestrator.ts";
import { buildStylePack } from "./pipeline/styleEngine.ts";
import type { ImageProvider } from "./providers/imageProvider.ts";
import type { TaskStore } from "./taskStore.ts";

const defaultConstraints: GenerationConstraints = {
  preserveStructure: true,
  styleLock: true,
  transparentBackground: true,
  fidelityLevel: "balanced",
  variationStrength: "medium",
  batchSize: 4,
  aspectRatio: "1:1",
  resolution: "2k",
};

const resolutions: OutputResolution[] = ["1k", "2k", "4k"];

function normalizeAspectRatio(value: unknown): AspectRatio {
  const raw = String(value || defaultConstraints.aspectRatio).trim();
  const match = raw.match(/^(\d{1,4}):(\d{1,4})$/);

  if (!match) {
    return defaultConstraints.aspectRatio;
  }

  const ratioWidth = Number(match[1]);
  const ratioHeight = Number(match[2]);

  if (!ratioWidth || !ratioHeight) {
    return defaultConstraints.aspectRatio;
  }

  return `${ratioWidth}:${ratioHeight}` as AspectRatio;
}

function normalizeConstraints(partial: Partial<GenerationConstraints>): GenerationConstraints {
  return {
    ...defaultConstraints,
    ...partial,
    batchSize: Math.min(Math.max(Number(partial.batchSize || defaultConstraints.batchSize), 1), 4),
    aspectRatio: normalizeAspectRatio(partial.aspectRatio),
    resolution: resolutions.includes(partial.resolution as OutputResolution) ? partial.resolution as OutputResolution : defaultConstraints.resolution,
  };
}

function buildDirectResults(generatedImages: GeneratedImage[], request: GenerateImageRequest): GenerationResult[] {
  return generatedImages.map((image, index) => ({
    id: `result_${index + 1}`,
    taskId: request.taskId,
    imageUrl: image.imageUrl,
    width: image.width,
    height: image.height,
    rank: index + 1,
    selected: index === 0,
    meta: {
      provider: image.provider,
      seed: image.seed,
    },
  }));
}

export class TaskService {
  private readonly store: TaskStore;
  private readonly imageProvider: ImageProvider;
  private readonly promptOrchestrator?: PromptOrchestrator;

  constructor(store: TaskStore, imageProvider: ImageProvider, promptOrchestrator?: PromptOrchestrator) {
    this.store = store;
    this.imageProvider = imageProvider;
    this.promptOrchestrator = promptOrchestrator;
  }

  async createTask(request: CreateTaskRequest): Promise<CreateTaskResponse> {
    const now = new Date().toISOString();
    const taskId = `task_${Date.now()}`;
    const constraints = normalizeConstraints(request.constraints || {});
    const inputAsset = parseInputAsset(request);
    const referenceAssets = parseReferenceAssets(request, inputAsset);
    const primaryInputAsset = referenceAssets[0] || inputAsset;
    const preprocess = preprocessInput(primaryInputAsset, constraints);
    const stylePack = buildStylePack(request.stylePresetId);
    let prompt = buildPromptBundle(primaryInputAsset, preprocess, stylePack, constraints, {
      userMessage: request.userMessage,
      agentSystemPrompt: request.agentSystemPrompt,
      materialPrompt: request.materialPrompt,
      colorPrompt: request.colorPrompt,
      shapeArchitecturePrompt: request.shapeArchitecturePrompt,
      extraNegativeRules: request.extraNegativeRules,
    });

    if (this.promptOrchestrator && request.usePromptOrchestrator !== false) {
      try {
        prompt = await this.promptOrchestrator.optimize({
          prompt,
          constraints,
          inputAsset: primaryInputAsset,
          referenceAssets,
          userMessage: request.userMessage,
          context: request.orchestrationContext,
        });
      } catch {
        // Prompt orchestration is an enhancement; generation should still work without it.
      }
    }
    const providerRequest: GenerateImageRequest = {
      taskId,
      inputAsset: primaryInputAsset,
      referenceAssets,
      stylePreset: stylePack.stylePreset,
      prompt,
      constraints,
    };
    const generatedImages = await this.imageProvider.generate(providerRequest);
    const results = buildDirectResults(generatedImages, providerRequest);

    const task: GenerationTask = {
      id: taskId,
      status: "completed",
      target: request.target,
      inputAsset: primaryInputAsset,
      referenceAssets,
      stylePreset: stylePack.stylePreset,
      constraints,
      preprocess,
      prompt,
      results,
      selectedResultId: results[0]?.id,
      debug: {
        usePromptOrchestrator: request.usePromptOrchestrator !== false,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.store.save(task);

    return {
      taskId,
      task,
    };
  }

  getTask(taskId: string): GenerationTask | undefined {
    return this.store.get(taskId);
  }

  selectResult(taskId: string, resultId: string): GenerationTask | undefined {
    return this.store.selectResult(taskId, resultId);
  }
}
