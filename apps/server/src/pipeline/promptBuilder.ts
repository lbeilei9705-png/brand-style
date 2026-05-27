import type { GenerationConstraints, InputAsset, PreprocessResult, PromptBundle } from "../../../../packages/shared/src/index.ts";
import type { StyleParameterPack } from "./styleEngine.ts";

const templateIntro = {
  sketch_to_3d: "",
  flat_to_3d: "基于输入扁平图形和本轮要求生成目标视觉结果。",
  other3d_to_brand3d: "基于输入参考图和本轮要求生成目标视觉结果。",
  illustration_to_icon: "基于输入插画和本轮要求生成目标视觉结果。",
};

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

function formatShapeRule(prompt?: string): string {
  if (!prompt) {
    return "";
  }

  const text = stripConfigLabel(prompt);

  return text ? `形状要求：${text}` : "";
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

function formatColorRule(prompt: string | undefined, shouldRemapManualPalette: boolean): string {
  if (!prompt) {
    return "未选择配色方案：按参考图的色彩关系，结合当前材质、光照和阴影进行自然转译。";
  }

  const { text, colors } = splitColorPrompt(prompt);
  const colorValues = colors.length ? ` 色值：${colors.join("、")}` : "";

  if (shouldRemapManualPalette) {
    return `配色要求：${text}${colorValues}。参考图颜色只用于识别结构，不保留未列入配色方案的大面积色相。`;
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
  const shouldTransferReferenceMaterial = hasReferenceMaterialTransferIntent(context.userMessage);
  const shouldPreserveExplicitColors = hasExplicitColorPreservation(context.userMessage);
  const isSketchTo3d = preprocess.mode === "sketch_to_3d";
  const preservationRule = isSketchTo3d
    ? ""
    : constraints.preserveStructure
    ? "必须保持原始图形的主轮廓、主体结构和核心识别特征，不要擅自改变图形语义。"
    : "允许在不改变主体识别度的前提下，对细节进行适度简化和归一。";
  const styleLockRule = isSketchTo3d
    ? ""
    : constraints.styleLock
    ? "按用户本轮指定的结构、颜色、材质和参考关系生成。"
    : "允许产生受控变化，但整体仍需保持在同一视觉家族内。";
  const shouldRemapManualPalette = context.colorPrompt?.includes("手动配色方案")
    && !context.colorPrompt.includes("原图色彩");
  const colorRule = context.colorPrompt
    ? formatColorRule(context.colorPrompt, Boolean(shouldRemapManualPalette))
    : shouldTransferReferenceMaterial && shouldPreserveExplicitColors
      ? "正在执行跨图材质/质感迁移，并且用户明确要求保持目标图颜色：必须保留目标图的原始色相、主色关系、局部颜色对应关系和色彩数量；只从来源图提取材质的物理属性，例如玻璃/塑料/金属/亚克力质感、透明度、厚度、粗糙度、折射、高光、阴影和边缘亮线。不要迁移来源图的绿色、品牌色或整体配色。"
    : shouldTransferReferenceMaterial && !shouldPreserveExplicitColors
      ? "正在执行跨图材质/质感迁移：目标图负责结构、轮廓、元素位置和识别特征；来源图负责材质、表面质感、光泽、厚度、透明度、高光阴影和必要的色彩倾向。允许为了匹配来源图材质而调整表面明暗、高光、阴影和材质色彩，不要被默认保留原色规则限制。"
    : formatColorRule(undefined, false);
  const referenceTransferRule = shouldTransferReferenceMaterial
    ? `跨图参考规则：当用户说“保持图1结构，把图2材质用到图1上”这类需求时，图1只提供结构、轮廓、构图和视觉语义；图2只提供材质、质感、表面工艺、光泽、透明度、厚度、高光和阴影。不要复制图2的物体形状、视觉内容或构图。${shouldPreserveExplicitColors ? "用户要求保持图1颜色时，图2的绿色/品牌色/配色不能迁移，只能迁移材质的物理质感。" : ""}`
    : "";
  const outputRule = `输出 ${constraints.aspectRatio}、${constraints.resolution}，高清锐利，材质细节清晰。`;
  const clarityRule = isSketchTo3d
    ? "清晰度规则：最终 3D 物件需要边缘锐利、材质微细节清晰、体块关系明确。"
    : "清晰度规则：必须边缘锐利、轮廓清楚、局部小图形和表情符号可辨认，材质微细节清晰。";
  const sheetClarityRule = isSketchTo3d
    ? "如果参考图包含多个小元素、贴纸或图标，允许把线条细节概括为独立 3D 物件、厚实体块或清晰的材质部件。"
    : "如果参考图包含多个小元素、贴纸或图标，必须让每个独立元素都保持清晰、边缘锐利和局部元素可辨认；不要生成缩略图感、不要把整组内容压缩成模糊拼贴。";
  const styleUseRule = context.agentSystemPrompt
    ? "吸收风格套装的整体渲染方向，并按当前已选形状、配色和材质执行。"
    : "";
  const negativeRules = splitNegativeRules([
    ...(context.extraNegativeRules || []),
    ...(isSketchTo3d ? [] : [
      "不要扭曲原始轮廓",
      "不要添加输入图之外的额外元素",
    ]),
    ...(context.colorPrompt ? [] : shouldTransferReferenceMaterial && shouldPreserveExplicitColors ? [
      "不要迁移材质来源图的颜色",
      "不要把图1改成图2的绿色或品牌色",
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
    "不要柔焦",
    "不要景深虚化",
    "不要运动模糊",
    "不要低分辨率",
    "不要过度平滑",
    "不要缩略图感",
    "不要模糊拼贴",
    ...(isSketchTo3d ? [] : [
      "不要让单个小图标细节不可辨认",
    ]),
  ]);

  return {
    positive: [
      context.agentSystemPrompt ? `风格渲染方向：${context.agentSystemPrompt}` : "",
      styleUseRule,
      context.userMessage ? `用户本轮要求：${context.userMessage}` : "",
      formatShapeRule(context.shapeArchitecturePrompt),
      formatMaterialRule(context.materialPrompt),
      referenceTransferRule,
      templateIntro[preprocess.mode],
      preservationRule,
      colorRule,
      styleLockRule,
      outputRule,
      clarityRule,
      sheetClarityRule,
      "输出需要高清、精致、统一、可复用，适合继续在设计工作流中使用。",
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
