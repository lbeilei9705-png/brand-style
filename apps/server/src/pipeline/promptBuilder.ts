import type { GenerationConstraints, InputAsset, PreprocessResult, PromptBundle } from "../../../../packages/shared/src/index.ts";
import type { StyleParameterPack } from "./styleEngine.ts";

const templateIntro = {
  sketch_to_3d: "基于输入线稿和本轮要求生成目标视觉结果。",
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
  const preservationRule = constraints.preserveStructure
    ? "必须保持原始图形的主轮廓、主体结构和核心识别特征，不要擅自改变图形语义。"
    : "允许在不改变主体识别度的前提下，对细节进行适度简化和归一。";
  const styleLockRule = constraints.styleLock
    ? "开启本轮要求锁定：必须优先保持用户指定的结构、颜色、材质、风格来源和参考图对应关系。"
    : "允许产生受控变化，但整体仍需保持在同一视觉家族内。";
  const colorRule = context.colorPrompt
    ? "必须优先遵循用户选择的配色方案，不要套用任何默认色板。"
    : shouldTransferReferenceMaterial && shouldPreserveExplicitColors
      ? "正在执行跨图材质/质感迁移，并且用户明确要求保持目标图颜色：必须保留目标图的原始色相、主色关系、局部颜色对应关系和色彩数量；只从来源图提取材质的物理属性，例如玻璃/塑料/金属/亚克力质感、透明度、厚度、粗糙度、折射、高光、阴影和边缘亮线。不要迁移来源图的绿色、品牌色或整体配色。"
    : shouldTransferReferenceMaterial && !shouldPreserveExplicitColors
      ? "正在执行跨图材质/质感迁移：目标图负责结构、轮廓、元素位置和识别特征；来源图负责材质、表面质感、光泽、厚度、透明度、高光阴影和必要的色彩倾向。允许为了匹配来源图材质而调整表面明暗、高光、阴影和材质色彩，不要被默认保留原色规则限制。"
    : "未选择配色方案：不要套用默认色板，必须优先保留参考图的原始色相、主色关系、色彩数量和局部颜色对应关系，只允许因材质、光照和阴影产生自然明暗变化。";
  const colorPriorityRule = "颜色优先级：用户本轮输入中明确写出的颜色、色值、Hex 或品牌色要求最高；其次是用户选择的配色配置；最后才参考风格 Skill 中的颜色描述。若三者冲突，必须以前者覆盖后者。";
  const referenceTransferRule = shouldTransferReferenceMaterial
    ? `跨图参考规则：当用户说“保持图1结构，把图2材质用到图1上”这类需求时，图1只提供结构、轮廓、构图和视觉语义；图2只提供材质、质感、表面工艺、光泽、透明度、厚度、高光和阴影。不要复制图2的物体形状、视觉内容或构图。${shouldPreserveExplicitColors ? "用户要求保持图1颜色时，图2的绿色/品牌色/配色不能迁移，只能迁移材质的物理质感。" : ""}`
    : "";
  const outputRule = `输出规格：画面比例为 ${constraints.aspectRatio}，清晰度为 ${constraints.resolution}。`;
  const clarityRule = "清晰度规则：必须边缘锐利、轮廓清楚、局部小图形和表情符号可辨认，材质微细节清晰；禁止柔焦、景深虚化、运动模糊、低分辨率放大感、糊边和过度降噪。";
  const sheetClarityRule = "如果参考图包含多个小元素、贴纸或图标，必须让每个独立元素都保持清晰、边缘锐利和局部元素可辨认；不要生成缩略图感、不要把整组内容压缩成模糊拼贴。";
  const skillPriorityRule = context.agentSystemPrompt
    ? "风格智能体规则为最高优先级；不得用未选择的模板或通用风格覆盖风格智能体中指定的材质、光影、质感和视觉方向。"
    : "";

  return {
    positive: [
      context.agentSystemPrompt ? `风格智能体规则：${context.agentSystemPrompt}` : "",
      skillPriorityRule,
      context.userMessage ? `用户本轮要求：${context.userMessage}` : "",
      context.shapeArchitecturePrompt ? `用户选择的形体架构：${context.shapeArchitecturePrompt}` : "",
      context.materialPrompt ? `用户选择的材质球：${context.materialPrompt}` : "",
      context.colorPrompt ? `用户选择的配色方案：${context.colorPrompt}` : "",
      referenceTransferRule,
      colorPriorityRule,
      templateIntro[preprocess.mode],
      preservationRule,
      colorRule,
      styleLockRule,
      outputRule,
      clarityRule,
      sheetClarityRule,
      skillPriorityRule ? "最终生成必须优先呈现风格智能体规则中的核心视觉特征，不得泛化为未选择的通用风格。" : "",
      context.colorPrompt || shouldTransferReferenceMaterial ? "" : "如果用户要求图形不变或色彩不变，必须逐图形保持原始颜色映射，不要把参考图统一改成蓝绿、蓝白、品牌紫绿或其他默认色系。",
      "输出需要高清、精致、统一、可复用，适合继续在设计工作流中使用。",
    ].filter(Boolean).join(" "),
    negative: [
      ...(context.extraNegativeRules || []),
      "不要扭曲原始轮廓",
      "不要添加输入图之外的额外元素",
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
      ] : [
        "不要改变参考图原始色相",
        "不要套用默认品牌色板",
        "不要把多彩图形统一改成蓝绿色系",
        "不要丢失局部颜色对应关系",
      ]),
      "不要模糊",
      "不要糊边",
      "不要柔焦",
      "不要景深虚化",
      "不要运动模糊",
      "不要低分辨率",
      "不要过度平滑",
      "不要缩略图感",
      "不要模糊拼贴",
      "不要让单个小图标细节不可辨认",
    ].join("；"),
    template: preprocess.mode,
    referencePack: {
      inputAssetId: inputAsset.id,
      stylePresetId: stylePreset?.id || "",
      styleAnchors: [],
    },
  };
}
