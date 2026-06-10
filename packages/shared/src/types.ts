export type InputType = "auto" | "line_sketch" | "flat_icon" | "colored_icon" | "3d_other" | "illustration";

export type GenerationMode = "sketch_to_3d" | "flat_to_3d" | "other3d_to_brand3d" | "illustration_to_icon";

export type TaskStatus = "queued" | "processing" | "completed" | "failed";

export type OutputTarget = "web" | "figma";

export type ModelProvider = "mock" | "fintopia";

export type ImageApiStyle = "azure" | "openai" | "custom";
export type ModelPurpose = "image" | "language";

export type AspectRatio = `${number}:${number}`;

export type OutputResolution = "1k" | "2k" | "4k";

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  model: string;
  apiUrl?: string;
  apiKey?: string;
  apiVersion?: string;
  apiStyle?: ImageApiStyle;
  apiPath?: string;
  purpose?: ModelPurpose;
  quality: "low" | "medium" | "high" | "auto";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialPresetConfig {
  id: string;
  name: string;
  description: string;
  prompt: string;
  previewColor?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ColorPaletteConfig {
  id: string;
  name: string;
  description: string;
  colors: string[];
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShapeArchitectureConfig {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OperationScenarioConfig {
  id: string;
  name: string;
  description: string;
  fixedPrompt: string;
  variablePrompt: string;
  content?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ScenarioAgentOutputMode = "json_final_prompt" | "prompt_sections";

export interface ScenarioAgentConfig {
  id: string;
  name: string;
  trigger: string;
  description: string;
  systemPrompt: string;
  outputMode: ScenarioAgentOutputMode;
  driverModelId?: string;
  version?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  defaultStylePresetId: string;
  defaultNegativeRules: string[];
  driverModelId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StyleSkillConfig = AgentConfig;

export interface StylePreset {
  id: string;
  name: string;
  shapeRules: {
    silhouette: "rounded" | "geometric" | "organic";
    detailLevel: "low" | "low_medium" | "medium";
  };
  volumeRules: {
    extrusionRatio: number;
    frontSideRatio: string;
  };
  bevelRules: {
    outer: "small" | "medium" | "large";
    inner: "small" | "medium" | "large";
  };
  materialRules: {
    primary: string;
    secondary: string;
  };
  lightingRules: {
    mainLight: string;
    shadow: "soft" | "medium";
    ambientOcclusion: "light" | "medium";
  };
  colorRules: {
    palette: string[];
    primaryRatio: number;
    secondaryRatio: number;
    accentRatio: number;
  };
  compositionRules: {
    view: "front" | "3q";
    layout: "center";
  };
  negativeRules: string[];
}

export interface InputAsset {
  id: string;
  referenceLabel?: string;
  type: Exclude<InputType, "auto">;
  source: "web_upload" | "figma_selection";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
  width?: number;
  height?: number;
  dominantColors: string[];
  hasBackground: boolean;
}

export interface PreprocessResult {
  detectedType: Exclude<InputType, "auto">;
  mode: GenerationMode;
  steps: string[];
  warnings: string[];
  normalizedAsset: {
    format: "png" | "svg" | "pdf" | "unknown";
    preserveStructure: boolean;
    transparentBackground: boolean;
  };
}

export interface GenerationConstraints {
  preserveStructure: boolean;
  styleLock: boolean;
  transparentBackground: boolean;
  fidelityLevel: "balanced" | "strict";
  variationStrength: "low" | "medium";
  batchSize: number;
  aspectRatio: AspectRatio;
  resolution: OutputResolution;
}

export interface PromptBundle {
  positive: string;
  negative: string;
  template: GenerationMode;
  referencePack: {
    inputAssetId: string;
    stylePresetId: string;
    styleAnchors: string[];
  };
}

export interface OperationScenarioPrompt {
  name: string;
  fixedPrompt: string;
  variablePrompt: string;
}

export interface PromptOrchestrationContext {
  selectedImage?: {
    referenceLabel?: string;
    filename: string;
    mimeType: string;
    width?: number;
    height?: number;
    sizeBytes: number;
  };
  selectedImages?: Array<{
    referenceLabel: string;
    filename: string;
    mimeType: string;
    width?: number;
    height?: number;
    sizeBytes: number;
  }>;
  styleSkill?: {
    name: string;
    description: string;
    systemPrompt: string;
  };
  materials?: Array<{
    name: string;
    description: string;
    prompt: string;
  }>;
  colorPalette?: {
    name: string;
    description: string;
    colors: string[];
    prompt: string;
  };
  shapeArchitecture?: {
    name: string;
    description: string;
    prompt: string;
  };
}

export interface GenerateImageRequest {
  taskId: string;
  inputAsset: InputAsset;
  referenceAssets?: InputAsset[];
  stylePreset?: StylePreset;
  prompt: PromptBundle;
  constraints: GenerationConstraints;
}

export interface GeneratedImage {
  id: string;
  imageUrl: string;
  width?: number;
  height?: number;
  seed: number;
  provider: "mock" | "nano_banana" | "fintopia";
}

export interface ResultScore {
  structureSimilarity: number;
  styleMatch: number;
  materialMatch: number;
  compositionStability: number;
  colorMatch: number;
  clarity: number;
  usability: number;
  total: number;
}

export interface GenerationResult {
  id: string;
  taskId: string;
  imageUrl: string;
  width?: number;
  height?: number;
  score?: ResultScore;
  rank: number;
  selected: boolean;
  reason?: string;
  meta: {
    provider: "mock" | "nano_banana" | "fintopia";
    seed: number;
  };
}

export interface GenerationTask {
  id: string;
  status: TaskStatus;
  target: OutputTarget;
  inputAsset: InputAsset;
  referenceAssets?: InputAsset[];
  stylePreset?: StylePreset;
  constraints: GenerationConstraints;
  preprocess: PreprocessResult;
  prompt: PromptBundle;
  results: GenerationResult[];
  selectedResultId?: string;
  debug?: {
    usePromptOrchestrator: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  inputType: InputType;
  stylePresetId?: string;
  source: "web_upload" | "figma_selection";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  assetDataUrl?: string;
  referenceAssets?: SelectionAsset[];
  userMessage?: string;
  agentSystemPrompt?: string;
  materialPrompt?: string;
  colorPrompt?: string;
  shapeArchitecturePrompt?: string;
  operationScenarioPrompt?: OperationScenarioPrompt;
  extraNegativeRules?: string[];
  usePromptOrchestrator?: boolean;
  orchestrationContext?: PromptOrchestrationContext;
  constraints: Partial<GenerationConstraints>;
  target: OutputTarget;
}

export interface CreateTaskResponse {
  taskId: string;
  task: GenerationTask;
}

export interface SelectionAsset {
  id: string;
  referenceLabel?: string;
  name: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  assetDataUrl?: string;
  width?: number;
  height?: number;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  taskId?: string;
  resultIds?: string[];
  selectionAssets?: SelectionAsset[];
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  agentId: string;
  messages: ConversationMessage[];
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationRequest {
  modelId: string;
  agentId: string;
  title?: string;
}

export interface AddConversationMessageRequest {
  content: string;
  modelId: string;
  agentId: string;
  inputType: InputType;
  selectionAssets: SelectionAsset[];
  batchSize?: number;
  aspectRatio?: AspectRatio;
  resolution?: OutputResolution;
  materialPresetId?: string;
  materialPresetIds?: string[];
  colorPaletteId?: string;
  shapeArchitectureId?: string;
  operationScenarioId?: string;
  usePromptOrchestrator?: boolean;
}

export interface AddConversationMessageResponse {
  conversation: Conversation;
  task?: GenerationTask;
}
