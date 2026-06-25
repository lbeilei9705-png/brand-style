import type { GenerationConstraints, InputAsset, OperationScenarioPrompt, PreprocessResult, PromptBundle } from "../../../../packages/shared/src/index.ts";
import type { StyleParameterPack } from "./styleEngine.ts";

const templateIntro = {
  sketch_to_3d: "",
  flat_to_3d: "基于参考图生成目标视觉结果。",
  other3d_to_brand3d: "基于参考图生成目标视觉结果。",
  illustration_to_icon: "基于参考图生成目标视觉结果。",
};

const lightweightStyleRenderingPrompt = "渲染方式：3D品牌视觉渲染，柔和均匀主光，商业产品光效，反射受控，不过曝高光，阴影柔和，AO极轻。";

function hasReferenceMaterialTransferIntent(message?: string): boolean {
  const text = message || "";

  return /图\s*\d/.test(text)
    && /(材质|质感|表面|光泽|光影|渲染|风格)/.test(text)
    && /(用到|应用到|套到|迁移|转移|参考|借鉴)/.test(text);
}

function hasExplicitColorPreservation(message?: string): boolean {
  return /(色彩不变|颜色不变|保留.{0,12}(颜色|色彩)|保持.{0,12}(颜色|色彩)|不要改色|不改色)/.test(message || "");
}

function normalizeNegativeRule(rule: string): string {
  return rule
    .replace(/^负面(提示词|词)?[:：]?/, "")
    .replace(/[。.!！；;，,\s]+$/g, "")
    .trim();
}

function splitNegativeRules(rules: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rule of rules) {
    for (const part of rule.split(/[；;、，,\n]+/)) {
      const normalized = normalizeNegativeRule(part);

      if (!normalized) {
        continue;
      }

      const key = normalized.replace(/\s+/g, "");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractHexColors(value: string): string[] {
  return uniqueValues(value.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
}

function stripConfigLabel(value: string): string {
  return value
    .replace(/^(形状|材质球|手动配色方案|风格套装默认配色)「[^」]+」[:：]\s*/, "")
    .replace(/\s*色值[:：][\s\S]*$/u, "")
    .trim();
}

function hasImageReference(inputAsset: InputAsset): boolean {
  return inputAsset.mimeType.startsWith("image/") && Boolean(inputAsset.dataUrl);
}

function formatStructureRule(prompt: string | undefined, shouldPreserveStructure: boolean, hasReferenceImage: boolean): string {
  const shapeText = prompt ? stripConfigLabel(prompt) : "";

  if (shapeText) {
    return `结构要求：${shapeText}`;
  }

  if (!hasReferenceImage) {
    return "";
  }

  return shouldPreserveStructure
    ? "结构要求：保持原图主体轮廓、主体结构、核心识别特征和图形语义。"
    : "结构要求：在不改变主体识别度的前提下，允许适度简化和归一。";
}

function formatMaterialRule(prompt?: string): string {
  if (!prompt) {
    return "";
  }

  const text = prompt
    .split(/[；;]/)
    .map(stripConfigLabel)
    .filter(Boolean)
    .join("；");

  return text ? `材质要求：${text}` : "";
}

function splitColorPrompt(prompt: string): { text: string; colors: string[] } {
  const colorValueMatch = prompt.match(/\s*色值[:：]\s*([\s\S]*)$/u);
  const text = stripConfigLabel(colorValueMatch ? prompt.slice(0, colorValueMatch.index) : prompt);
  const colors = uniqueValues([
    ...extractHexColors(colorValueMatch?.[1] || ""),
    ...extractHexColors(prompt),
  ]);

  return { text, colors };
}

function formatColorRule(prompt: string | undefined, shouldRemapManualPalette: boolean, hasReferenceImage: boolean): string {
  if (!prompt) {
    return "";
  }

  const { text, colors } = splitColorPrompt(prompt);
  const colorValues = colors.length ? ` 色值：${colors.join("、")}` : "";

  if (shouldRemapManualPalette) {
    return hasReferenceImage
      ? `配色要求：当前选择的配色方案为 ${text}${colorValues}；必须将该配色方案作为画面主要可见配色执行。保留参考图的结构、图标数量、元素位置、明暗层级和色块面积关系，但不要保留参考图原有色相。`
      : `配色要求：当前选择的配色方案为 ${text}${colorValues}；必须将该配色方案作为画面主要可见配色执行。`;
  }

  return `配色要求：${text}${colorValues}。`;
}

export function buildPromptBundle(
  inputAsset: InputAsset,
  preprocess: PreprocessResult,
  stylePack: StyleParameterPack,
  constraints: GenerationConstraints,
  context: {
    userMessage?: string;
    agentSystemPrompt?: string;
    materialPrompt?: string;
    colorPrompt?: string;
    shapeArchitecturePrompt?: string;
    extraNegativeRules?: string[];
  } = {},
): PromptBundle {
  const { stylePreset } = stylePack;
  const hasReferenceImage = hasImageReference(inputAsset);
  const shouldTransferReferenceMaterial = hasReferenceMaterialTransferIntent(context.userMessage);
  const shouldPreserveExplicitColors = hasExplicitColorPreservation(context.userMessage);
  const isSketchTo3d = preprocess.mode === "sketch_to_3d";
  const shouldSkipDefaultStructureRule = shouldTransferReferenceMaterial && !context.shapeArchitecturePrompt;
  const structureRule = isSketchTo3d || shouldSkipDefaultStructureRule
    ? ""
    : formatStructureRule(context.shapeArchitecturePrompt, constraints.preserveStructure, hasReferenceImage);
  const shouldRemapManualPalette = context.colorPrompt?.includes("手动配色方案")
    && !context.colorPrompt.includes("原图色彩");
  const colorRule = context.colorPrompt
    ? formatColorRule(context.colorPrompt, Boolean(shouldRemapManualPalette), hasReferenceImage)
    : shouldTransferReferenceMaterial && shouldPreserveExplicitColors
      ? "跨图色彩规则：用户明确要求保持颜色时，按用户原文指定的目标图或结构图保留原有色彩关系；材质来源图只提供材质和质感，不覆盖颜色。"
    : shouldTransferReferenceMaterial && !shouldPreserveExplicitColors
      ? "跨图色彩规则：未选择配色方案时，优先按用户原文中指定的色彩来源执行；如果用户没有指定色彩来源，则结合参考图色彩关系、材质、光照和阴影自然转译。"
    : formatColorRule(undefined, false, hasReferenceImage);
  const referenceTransferRule = shouldTransferReferenceMaterial
    ? "跨图参考规则：严格按用户本轮输入中的图号关系执行，不要混淆图1、图2、图3等参考图的职责。"
    : "";
  const shouldUseLightweightStyleRenderingPrompt = Boolean(context.materialPrompt || context.colorPrompt)
    && !context.agentSystemPrompt
    && !stylePreset;
  const outputRule = isSketchTo3d
    ? `输出 ${constraints.aspectRatio}、${constraints.resolution}，清晰锐利，材质和体块关系可辨。`
    : `输出 ${constraints.aspectRatio}、${constraints.resolution}，清晰锐利，材质和小元素可辨。`;
  const negativeRules = splitNegativeRules([
    ...(context.extraNegativeRules || []),
    ...(!hasReferenceImage || isSketchTo3d ? [] : [
      "不要扭曲原始轮廓",
      "不要添加输入图之外的额外元素",
    ]),
    ...(shouldRemapManualPalette ? [
      "不要保留参考图原有配色",
      "不要弱化当前选择的配色方案",
      "不要让原图色相覆盖手动配色",
    ] : context.colorPrompt ? [] : shouldTransferReferenceMaterial && shouldPreserveExplicitColors ? [
      "不要迁移材质来源图的颜色",
      "不要让材质来源图的颜色覆盖结构来源图",
      "不要复制材质来源图的物体形状",
      "不要忽略材质来源图的表面质感",
      "不要保持扁平贴纸质感",
    ] : shouldTransferReferenceMaterial && !shouldPreserveExplicitColors ? [
      "不要复制材质来源图的物体形状",
      "不要忽略材质来源图的表面质感",
      "不要只保留目标图的扁平原色而不迁移材质",
    ] : []),
    "不要模糊",
    "不要糊边",
    "不要低分辨率",
  ]);

  return {
    positive: [
      context.agentSystemPrompt ? `风格渲染方向：${context.agentSystemPrompt}` : "",
      shouldUseLightweightStyleRenderingPrompt ? lightweightStyleRenderingPrompt : "",
      context.userMessage ? `用户本轮要求：${context.userMessage}` : "",
      structureRule,
      formatMaterialRule(context.materialPrompt),
      referenceTransferRule,
      hasReferenceImage ? templateIntro[preprocess.mode] : "基于用户文字需求生成目标视觉结果。",
      colorRule,
      outputRule,
    ].filter(Boolean).join(" "),
    negative: negativeRules.join("；"),
    template: preprocess.mode,
    referencePack: {
      inputAssetId: inputAsset.id,
      stylePresetId: stylePreset?.id || "",
      styleAnchors: [],
    },
  };
}

export function buildOperationScenarioPromptBundle(
  inputAsset: InputAsset,
  preprocess: PreprocessResult,
  stylePack: StyleParameterPack,
  scenarioPrompt: OperationScenarioPrompt,
): PromptBundle {
  const { stylePreset } = stylePack;
  const negativeRules = splitNegativeRules([
    ...(scenarioPrompt.negativeRules || []),
    "不要模糊",
    "不要糊边",
    "不要低分辨率",
  ]);

  return {
    positive: [
      scenarioPrompt.fixedPrompt,
      scenarioPrompt.variablePrompt,
    ].map((part) => part.trim()).filter(Boolean).join("\n\n"),
    negative: negativeRules.join("；"),
    template: preprocess.mode,
    referencePack: {
      inputAssetId: inputAsset.id,
      stylePresetId: stylePreset?.id || "",
      styleAnchors: [],
    },
  };
}
