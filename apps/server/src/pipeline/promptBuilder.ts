import type { GenerationConstraints, InputAsset, PreprocessResult, PromptBundle } from "../../../../packages/shared/src/index.ts";
import type { StyleParameterPack } from "./styleEngine.ts";

const templateIntro = {
  sketch_to_3d: "基于输入线稿和本轮要求生成目标视觉结果；线条只作为结构蓝图，不作为最终视觉元素。",
  flat_to_3d: "基于输入扁平图形和本轮要求生成目标视觉结果。",
  other3d_to_brand3d: "基于输入参考图和本轮要求生成目标视觉结果。",
  illustration_to_icon: "基于输入插画和本轮要求生成目标视觉结果。",
};

const sketchTo3dRule = "线稿转 3D 规则：不要保留黑色描边、草图线、手绘轮廓线或线框感；必须把线稿暗示的平面轮廓重建为有厚度、有倒角、有体块层级、有真实材质和光影的 3D 结构。线条位置只用于判断物件边界、结构分区和元素关系，最终画面应是完整 3D 物件，不是描边插画。";

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
    ? "以参考图的大致语义、元素关系和构图节奏为基础，允许重建、概括、加厚、简化或合并线条细节。"
    : constraints.preserveStructure
    ? "以参考图的主体识别特征为基础进行风格转译，允许根据材质、体积和光影做必要重塑。"
    : "允许在不改变主体识别度的前提下，对细节进行适度简化和归一。";
  const styleLockRule = isSketchTo3d
    ? ""
    : constraints.styleLock
    ? "开启本轮要求锁定：必须优先保持用户指定的结构、颜色、材质、风格来源和参考图对应关系。"
    : "允许产生受控变化，但整体仍需保持在同一视觉家族内。";
  const colorRule = context.colorPrompt
    ? "必须优先遵循当前启用的配色方案；若用户本轮输入另有明确颜色或色值，以用户输入优先。"
    : shouldTransferReferenceMaterial && shouldPreserveExplicitColors
      ? "正在执行跨图材质/质感迁移，并且用户明确要求保持目标图颜色：必须保留目标图的原始色相、主色关系、局部颜色对应关系和色彩数量；只从来源图提取材质的物理属性，例如玻璃/塑料/金属/亚克力质感、透明度、厚度、粗糙度、折射、高光、阴影和边缘亮线。不要迁移来源图的绿色、品牌色或整体配色。"
    : shouldTransferReferenceMaterial && !shouldPreserveExplicitColors
      ? "正在执行跨图材质/质感迁移：目标图负责结构、轮廓、元素位置和识别特征；来源图负责材质、表面质感、光泽、厚度、透明度、高光阴影和必要的色彩倾向。允许为了匹配来源图材质而调整表面明暗、高光、阴影和材质色彩，不要被默认保留原色规则限制。"
    : "未选择配色方案：按参考图的色彩关系，结合当前材质、光照和阴影进行自然转译。";
  const colorPriorityRule = "颜色优先级：用户本轮输入中明确写出的颜色、色值、Hex 或品牌色要求最高；其次是当前启用的配色配置（用户手动选择优先，未选择时使用风格套装默认配色）；最后才参考风格套装中未作为默认配色启用的颜色描述。若三者冲突，必须以前者覆盖后者。";
  const referenceTransferRule = shouldTransferReferenceMaterial
    ? `跨图参考规则：当用户说“保持图1结构，把图2材质用到图1上”这类需求时，图1只提供结构、轮廓、构图和视觉语义；图2只提供材质、质感、表面工艺、光泽、透明度、厚度、高光和阴影。不要复制图2的物体形状、视觉内容或构图。${shouldPreserveExplicitColors ? "用户要求保持图1颜色时，图2的绿色/品牌色/配色不能迁移，只能迁移材质的物理质感。" : ""}`
    : "";
  const outputRule = `输出规格：画面比例为 ${constraints.aspectRatio}，清晰度为 ${constraints.resolution}。`;
  const clarityRule = isSketchTo3d
    ? "清晰度规则：最终 3D 物件需要边缘锐利、材质微细节清晰、体块关系明确。"
    : "清晰度规则：必须边缘锐利、轮廓清楚、局部小图形和表情符号可辨认，材质微细节清晰。";
  const sheetClarityRule = isSketchTo3d
    ? "如果参考图包含多个小元素、贴纸或图标，允许把线条细节概括为独立 3D 物件、厚实体块或清晰的材质部件。"
    : "如果参考图包含多个小元素、贴纸或图标，必须让每个独立元素都保持清晰、边缘锐利和局部元素可辨认；不要生成缩略图感、不要把整组内容压缩成模糊拼贴。";
  const skillPriorityRule = context.agentSystemPrompt
    ? "优先级规则：用户输入 > 自由搭配（形状 / 配色 / 材质）> 风格套装 > 默认高清规则；风格套装提供整体视觉方向，但不得覆盖用户本轮要求和已选择的自由搭配配置。"
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
    ...(isSketchTo3d ? [
      "不要保留线稿描边",
      "不要保留黑色轮廓线",
      "不要生成线框图",
      "不要只是给线稿上色",
      "不要二维描边插画感",
    ] : []),
  ]);

  return {
    positive: [
      context.agentSystemPrompt ? `风格智能体规则：${context.agentSystemPrompt}` : "",
      skillPriorityRule,
      context.userMessage ? `用户本轮要求：${context.userMessage}` : "",
      context.shapeArchitecturePrompt ? `用户选择的形状：${context.shapeArchitecturePrompt}` : "",
      context.materialPrompt ? `用户选择的材质球：${context.materialPrompt}` : "",
      context.colorPrompt ? `当前启用的配色方案：${context.colorPrompt}` : "",
      referenceTransferRule,
      colorPriorityRule,
      templateIntro[preprocess.mode],
      isSketchTo3d ? sketchTo3dRule : "",
      preservationRule,
      colorRule,
      styleLockRule,
      outputRule,
      clarityRule,
      sheetClarityRule,
      skillPriorityRule ? "最终生成必须优先满足用户本轮要求和自由搭配配置，再吸收风格套装中的核心视觉特征，不得泛化为未选择的通用风格。" : "",
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
