import type { GenerationConstraints, InputAsset, PromptBundle, PromptOrchestrationContext } from "../../../../packages/shared/src/index.ts";

export interface OptimizePromptRequest {
  prompt: PromptBundle;
  constraints: GenerationConstraints;
  inputAsset: InputAsset;
  referenceAssets?: InputAsset[];
  userMessage?: string;
  context?: PromptOrchestrationContext;
}

export interface ReferenceRolePlan {
  taskType?: string;
  targetImage?: string | null;
  structureSource?: string | null;
  colorSource?: string | null;
  materialSource?: string | null;
  styleSource?: string | null;
  preserveStructure?: boolean;
  transferColor?: boolean;
  transferMaterial?: boolean;
  transferStyle?: boolean;
}

export interface ValidatedReferenceRolePlan {
  taskType: string;
  targetImage: string;
  structureSource: string;
  colorSource?: string;
  materialSource?: string;
  styleSource?: string;
  preserveStructure: boolean;
  transferColor: boolean;
  transferMaterial: boolean;
  transferStyle: boolean;
}
