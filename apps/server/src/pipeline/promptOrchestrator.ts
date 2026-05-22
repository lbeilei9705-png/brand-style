import type { GenerationConstraints, InputAsset, ModelConfig, PromptBundle, PromptOrchestrationContext } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  } | string;
}

interface OptimizePromptRequest {
  prompt: PromptBundle;
  constraints: GenerationConstraints;
  inputAsset: InputAsset;
  referenceAssets?: InputAsset[];
  context?: PromptOrchestrationContext;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildEndpoint(model: ModelConfig, fallback?: FintopiaConfig): string {
  const apiUrl = model.apiUrl || fallback?.apiUrl || "";
  const apiStyle = model.apiStyle || fallback?.apiStyle || "azure";
  const apiPath = model.apiPath || fallback?.apiPath || "";
  const version = model.apiVersion || fallback?.version || "";
  const encodedModel = encodeURIComponent(model.model);
  const base = trimTrailingSlash(apiUrl);

  if (apiPath) {
    const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
    const endpoint = `${base}${path.replace("{model}", encodedModel)}`;
    return version ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(version)}` : endpoint;
  }

  if (apiStyle === "openai" || apiStyle === "custom") {
    return `${base}/v1/chat/completions`;
  }

  const endpoint = `${base}/openai/deployments/${encodedModel}/chat/completions`;
  return version ? `${endpoint}?api-version=${encodeURIComponent(version)}` : endpoint;
}

function buildHeaders(model: ModelConfig, fallback?: FintopiaConfig): HeadersInit {
  const apiKey = model.apiKey || fallback?.apiKey || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if ((model.apiStyle || fallback?.apiStyle || "azure") === "azure" && !model.apiPath) {
    headers["api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function extractJsonObject(content: string): { positive?: string; negative?: string } | undefined {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);

    if (!match) {
      return undefined;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  }
}

function normalizeNegativeRule(rule: string): string {
  return rule
    .replace(/^负面(提示词|词)?[:：]?/, "")
    .replace(/[。.!！；;，,\s]+$/g, "")
    .trim();
}

function dedupeNegativePrompt(prompt: string): string {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of prompt.split(/[；;、，,\n]+/)) {
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

  return result.join("；");
}

function hasReferenceMaterialTransferIntent(message?: string): boolean {
  const text = message || "";

  return /图\s*\d/.test(text)
    && /(材质|质感|表面|光泽|光影|渲染|风格)/.test(text)
    && /(用到|应用到|套到|迁移|转移|参考|借鉴)/.test(text);
}

function hasExplicitColorPreservation(message?: string): boolean {
  return /(色彩不变|颜色不变|保留.{0,12}(颜色|色彩)|保持.{0,12}(颜色|色彩)|不要改色|不改色)/.test(message || "");
}

function formatContext(context: PromptOrchestrationContext | undefined, options: { allowMaterialTransferColorShift?: boolean } = {}): string {
  if (!context) {
    return "无额外编排上下文。";
  }

  const selectedImages = context.selectedImages?.length
    ? context.selectedImages
    : context.selectedImage
      ? [{
        referenceLabel: context.selectedImage.referenceLabel || "图1",
        filename: context.selectedImage.filename,
        mimeType: context.selectedImage.mimeType,
        width: context.selectedImage.width,
        height: context.selectedImage.height,
        sizeBytes: context.selectedImage.sizeBytes,
      }]
      : [];
  const selectedImageText = selectedImages.length
    ? selectedImages.map((image, index) => [
      `${image.referenceLabel || `图${index + 1}`}：${image.filename}`,
      `类型：${image.mimeType}`,
      image.width && image.height ? `尺寸：${image.width}x${image.height}` : "",
      `大小：${Math.round(image.sizeBytes / 1024)}KB`,
    ].filter(Boolean).join("，")).join("\n")
    : "未提供选中图片信息";
  const styleSkill = context.styleSkill
    ? [
      `名称：${context.styleSkill.name}`,
      `说明：${context.styleSkill.description}`,
      `后台风格 Skill 提示词：${context.styleSkill.systemPrompt}`,
    ].join("\n")
    : "未选择风格 Skill";
  const materials = context.materials?.length
    ? context.materials.map((material) => `- ${material.name}：${material.description}；${material.prompt}`).join("\n")
    : "未选择材质";
  const colorPalette = context.colorPalette
    ? `${context.colorPalette.name}：${context.colorPalette.description}；${context.colorPalette.prompt}；色值：${context.colorPalette.colors.join("、")}`
    : "未选择配色";
  const shapeArchitecture = context.shapeArchitecture
    ? `${context.shapeArchitecture.name}：${context.shapeArchitecture.description}；${context.shapeArchitecture.prompt}`
    : "未选择形状";
  const colorInstruction = context.colorPalette
    ? "当前已有启用配色方案，最终提示词必须优先按该配色方案统一色彩；如果用户本轮输入中另有明确颜色或色值，以用户输入优先。"
    : options.allowMaterialTransferColorShift
      ? "用户未选择配色方案，但当前是跨图材质/质感迁移；允许来源图材质带来的必要表面颜色、明暗、高光和阴影变化。"
    : "用户未选择配色方案，按参考图的色彩关系，结合当前材质、光照和阴影进行自然转译。";

  return [
    `选中图片信息：\n${selectedImageText}`,
    `风格 Skill：\n${styleSkill}`,
    `形状配置：${shapeArchitecture}`,
    `材质配置：\n${materials}`,
    `配色配置：${colorPalette}`,
    `配色执行规则：${colorInstruction}`,
  ].join("\n\n");
}

function buildUserContent(request: OptimizePromptRequest): string | Array<Record<string, unknown>> {
  const shouldTransferReferenceMaterial = hasReferenceMaterialTransferIntent(request.prompt.positive);
  const shouldPreserveExplicitColors = hasExplicitColorPreservation(request.prompt.positive);
  const isSketchTo3d = /输入线稿|线稿转\s*3D|line[_\s-]*sketch/i.test(request.prompt.positive);
  const colorFallbackRule = shouldTransferReferenceMaterial && shouldPreserveExplicitColors
    ? "如果用户要求保持目标图颜色，同时把另一张图的材质/质感用到目标图上，必须保留目标图的原始色相、主色关系、局部颜色对应关系和色彩数量；只迁移来源图的物理材质属性，如透明度、厚度、折射、粗糙度、金属/塑料/玻璃质感、高光和阴影。不要迁移来源图的绿色、品牌色或整体配色。"
    : shouldTransferReferenceMaterial && !shouldPreserveExplicitColors
    ? "如果用户要求把某张参考图的材质/质感用到另一张参考图上，材质来源图的表面质感、光泽、透明度、厚度、高光、阴影和必要色彩倾向优先于默认保留原色规则。"
    : "如果未选择配色方案，按参考图色彩关系与当前材质光影自然转译。";
  const text = [
    "请基于下面所有信息，组合一份最终生图提示词。",
    "你需要先理解选中图片的主体轮廓、构图、颜色和语义，再结合用户本轮输入、后台风格 Skill、形状配置、材质配置和配色配置。",
    "如果有多张参考图，必须严格按“图1、图2、图3...”识别和引用，用户本轮输入中提到“图1/图2”时，必须对应到同编号参考图，不要混淆。",
    "跨图材质迁移必须拆分职责：目标图只提供结构、轮廓、布局、视觉语义和用户要求保留的颜色；来源图只提供材质、质感、表面工艺、光泽、透明度、厚度、高光和阴影，不要把来源图的物体形状、视觉内容或配色复制过去。",
    "如果用户要求“图形不变”“结构不变”“色彩不变”，最终提示词应以选中图片的识别特征和关系为基础，只改变用户要求的风格、材质、光影和质感。",
    "优先级必须严格执行：用户输入 > 自由搭配（形状 / 配色 / 材质）> 风格套装 > 默认高清规则。风格套装提供整体视觉方向，但不得覆盖用户本轮要求和已选择的自由搭配配置。",
    "颜色优先级必须严格执行：用户本轮输入里明确写出的颜色、色值、Hex 或品牌色要求最高；当前启用的配色配置第二（用户手动选择优先，未选择时使用风格套装默认配色）；风格套装中未作为默认配色启用的颜色描述最低。冲突时以前者覆盖后者。",
    colorFallbackRule,
    isSketchTo3d ? "当前是线稿转 3D：线条只作为结构蓝图，不得作为最终视觉元素；最终 positive 必须明确要求移除黑色描边、草图线、手绘轮廓线和线框感，并重建有厚度、倒角、体块层级、材质和光影的 3D 结构。" : "",
    "最终正向提示词必须强化清晰度，但不要堆叠重复的负面词；“不要模糊、不要糊边、不要柔焦”等禁止项集中合并到 negative。",
    "如果参考图包含多个小元素、贴纸或图标，最终提示词必须要求每个独立元素都清晰可辨，不要生成缩略图感或模糊拼贴。",
    "没有明确选择的模板不得参与改写，也不得泛化成未选择的通用风格。",
    "negative 必须去重：同义或完全相同的禁止项只保留一次。",
    "不要输出思考过程，只输出 JSON。",
    "",
    `编排上下文：\n${formatContext(request.context, { allowMaterialTransferColorShift: shouldTransferReferenceMaterial && !shouldPreserveExplicitColors })}`,
    "",
    `当前正向提示词：${request.prompt.positive}`,
    `当前负向提示词：${request.prompt.negative}`,
    `输出比例：${request.constraints.aspectRatio}`,
    `清晰度：${request.constraints.resolution}`,
    "",
    "输出 JSON 字段：positive、negative。positive 要是一段可直接发给图像模型的最终中文提示词；negative 要合并所有必要负向约束。",
  ].join("\n\n");

  const referenceAssets = (request.referenceAssets?.length ? request.referenceAssets : [request.inputAsset])
    .filter((asset) => asset.dataUrl && asset.mimeType.startsWith("image/"));

  if (!referenceAssets.length) {
    return text;
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text,
    },
  ];

  for (const [index, asset] of referenceAssets.entries()) {
    content.push({
      type: "text",
      text: `${asset.referenceLabel || `图${index + 1}`} 参考图：${asset.filename}`,
    });
    content.push({
      type: "image_url",
      image_url: {
        url: asset.dataUrl,
      },
    });
  }

  return content;
}

export class PromptOrchestrator {
  private readonly model: ModelConfig;
  private readonly fallbackConfig?: FintopiaConfig;

  constructor(model: ModelConfig, fallbackConfig?: FintopiaConfig) {
    this.model = model;
    this.fallbackConfig = fallbackConfig;
  }

  async optimize(request: OptimizePromptRequest): Promise<PromptBundle> {
    const endpoint = buildEndpoint(this.model, this.fallbackConfig);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(this.model, this.fallbackConfig),
      body: JSON.stringify({
        model: (this.model.apiStyle || this.fallbackConfig?.apiStyle) === "azure" ? undefined : this.model.model,
        messages: [
          {
            role: "system",
            content: "你是一个多模态 3D 视觉生图 Prompt 编排器。你需要阅读用户选中的参考图，结合用户本轮输入、风格套装、材质、形状和配色配置，生成最终可直接用于生图模型的提示词。不要引用历史对话上下文。如果有多张参考图，必须严格按“图1、图2、图3...”区分它们，用户提到某张图时不得混淆。你必须保持用户核心意图；优先级为：用户输入 > 自由搭配（形状/配色/材质）> 风格套装 > 默认高清规则。颜色优先级为：用户输入的颜色/色值最高，当前启用配色第二，风格套装中未作为默认配色启用的颜色描述最低；用户未手动选择配色时，可启用风格套装默认配色。未选择任何配色方案时，按照原图色彩执行；如果当前任务是线稿转 3D，线条只能作为结构蓝图，不得作为最终视觉元素，必须重建真实 3D 体块、厚度、倒角、材质和光影。必须强化高清锐利输出，但不要在 positive 堆叠重复负面词，禁止项合并到 negative 且去重。只输出 JSON，字段为 positive 和 negative，不要输出 Markdown。",
          },
          {
            role: "user",
            content: buildUserContent(request),
          },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json() as ChatCompletionResponse;

    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || `语言模型请求失败，HTTP ${response.status}`);
    }

    const content = payload.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(content);

    if (!parsed?.positive) {
      throw new Error("语言模型未返回可用的 positive prompt。");
    }

    return {
      ...request.prompt,
      positive: parsed.positive,
      negative: dedupeNegativePrompt(parsed.negative || request.prompt.negative),
    };
  }
}
