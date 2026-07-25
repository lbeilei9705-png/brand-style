import type { GenerateImageRequest } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";
import type { EndpointKind } from "./fintopiaEndpoint.ts";

function formatReferenceSummary(request: GenerateImageRequest): string {
  const assets = request.referenceAssets?.length ? request.referenceAssets : [request.inputAsset];

  return assets.map((asset, index) => {
    const size = asset.width && asset.height ? `，尺寸 ${asset.width}x${asset.height}` : "";

    return `${asset.referenceLabel || `图${index + 1}`}：${asset.filename}${size}`;
  }).join("；");
}

function hasExplicitColorPreservation(message?: string): boolean {
  return /(色彩不变|颜色不变|保留.{0,12}(颜色|色彩)|保持.{0,12}(颜色|色彩)|不要改色|不改色)/.test(message || "");
}

function buildPrompt(request: GenerateImageRequest): string {
  const materialTransferRule = hasExplicitColorPreservation(request.prompt.positive)
    ? "跨图材质迁移规则：如果用户要求保持图1结构和颜色、把图2的材质用到图1上，图1提供结构、轮廓、布局、图标语义和原始颜色；图2只提供材质、质感、表面工艺、光泽、透明度、厚度、高光和阴影。必须保留图1的色相和局部颜色映射，但把这些颜色渲染成图2那种材质表面。不要复制图2的物体形状、图标内容或绿色配色。"
    : "跨图材质迁移规则：如果用户要求把图2的材质用到图1上，图1只提供结构、轮廓、布局和图标语义；图2只提供材质、质感、表面工艺、光泽、透明度、厚度、高光和阴影。不要复制图2的物体形状，也不要只保留图1的扁平原色而忽略图2材质。";
  const referencePack = request.prompt.referencePack.styleAnchors.length
    ? `参考图包：${request.prompt.referencePack.styleAnchors.join("；")}`
    : "";

  return [
    request.prompt.positive,
    `负向约束：${request.prompt.negative}`,
    `参考图编号：${formatReferenceSummary(request)}。如果用户提示词提到图1、图2等编号，必须严格对应同编号参考图，不要混淆。`,
    materialTransferRule,
    referencePack,
  ].filter(Boolean).join("\n\n");
}

export function buildHeaders(apiKey: string, kind: EndpointKind): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (kind === "azure-images") {
    headers["api-key"] = apiKey;
  } else if (kind === "gemini-generate-content") {
    // Gemini-compatible Yunwu endpoints authenticate with a key query parameter.
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] || 0) + ((bytes[offset + 1] || 0) << 8);
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] || 0) + ((bytes[offset + 1] || 0) << 8) + ((bytes[offset + 2] || 0) << 16);
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] || 0)
    + ((bytes[offset + 1] || 0) << 8)
    + ((bytes[offset + 2] || 0) << 16)
    + ((bytes[offset + 3] || 0) << 24);
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] || 0) << 24)
    + ((bytes[offset + 1] || 0) << 16)
    + ((bytes[offset + 2] || 0) << 8)
    + (bytes[offset + 3] || 0);
}

function parseImageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;

  if (isPng && bytes.length >= 24) {
    return {
      width: readUint32Be(bytes, 16),
      height: readUint32Be(bytes, 20),
    };
  }

  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let offset = 2;

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xFF) {
        offset += 1;
        continue;
      }

      const marker = bytes[offset + 1];
      const length = ((bytes[offset + 2] || 0) << 8) + (bytes[offset + 3] || 0);

      if (marker >= 0xC0 && marker <= 0xC3 && offset + 8 < bytes.length) {
        return {
          height: ((bytes[offset + 5] || 0) << 8) + (bytes[offset + 6] || 0),
          width: ((bytes[offset + 7] || 0) << 8) + (bytes[offset + 8] || 0),
        };
      }

      offset += 2 + length;
    }
  }

  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

  if (!isWebp || bytes.length < 30) {
    return undefined;
  }

  let offset = 12;

  while (offset + 8 < bytes.length) {
    const chunk = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = readUint32Le(bytes, offset + 4);
    const dataOffset = offset + 8;

    if (chunk === "VP8X" && dataOffset + 10 <= bytes.length) {
      return {
        width: readUint24Le(bytes, dataOffset + 4) + 1,
        height: readUint24Le(bytes, dataOffset + 7) + 1,
      };
    }

    if (chunk === "VP8L" && dataOffset + 5 <= bytes.length && bytes[dataOffset] === 0x2F) {
      const b1 = bytes[dataOffset + 1] || 0;
      const b2 = bytes[dataOffset + 2] || 0;
      const b3 = bytes[dataOffset + 3] || 0;
      const b4 = bytes[dataOffset + 4] || 0;

      return {
        width: 1 + (((b2 & 0x3F) << 8) | b1),
        height: 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6)),
      };
    }

    if (chunk === "VP8 " && dataOffset + 10 <= bytes.length) {
      return {
        width: readUint16Le(bytes, dataOffset + 6) & 0x3FFF,
        height: readUint16Le(bytes, dataOffset + 8) & 0x3FFF,
      };
    }

    offset += 8 + size + (size % 2);
  }

  return undefined;
}

export async function getActualImageSize(imageUrl: string): Promise<{ width: number; height: number } | undefined> {
  try {
    if (imageUrl.startsWith("data:")) {
      const base64 = imageUrl.split(",")[1] || "";
      return parseImageSize(new Uint8Array(Buffer.from(base64, "base64")));
    }

    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return undefined;
    }

    return parseImageSize(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return undefined;
  }
}

export function buildOutputSize(request: GenerateImageRequest): { width: number; height: number; size: string } {
  const [ratioWidth, ratioHeight] = request.constraints.aspectRatio.split(":").map(Number);
  const base = request.constraints.resolution === "4k"
    ? 4096
    : request.constraints.resolution === "2k"
      ? 2048
      : 1024;
  const rawWidth = ratioWidth >= ratioHeight
    ? base
    : Math.round(base * ratioWidth / ratioHeight);
  const rawHeight = ratioHeight >= ratioWidth
    ? base
    : Math.round(base * ratioHeight / ratioWidth);
  const width = Math.max(16, Math.floor(rawWidth / 16) * 16);
  const height = Math.max(16, Math.floor(rawHeight / 16) * 16);

  return {
    width,
    height,
    size: `${width}x${height}`,
  };
}

function normalizeGeminiAspectRatio(aspectRatio: string): string {
  const [width, height] = aspectRatio.split(":").map(Number);
  const ratio = width && height ? width / height : 1;
  const supported = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"];

  return supported.reduce((best, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.split(":").map(Number);
    const bestDistance = Math.abs((Number(best.split(":")[0]) / Number(best.split(":")[1])) - ratio);
    const candidateDistance = Math.abs((candidateWidth / candidateHeight) - ratio);

    return candidateDistance < bestDistance ? candidate : best;
  }, "1:1");
}

function dataUrlToInlineData(dataUrl: string): { mimeType: string; data: string } | undefined {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);

  if (!match) {
    return undefined;
  }

  return {
    mimeType: match[1],
    data: match[2],
  };
}

function buildVariantInstruction(variantIndex: number, variantCount: number): string {
  if (variantCount <= 1) {
    return "";
  }

  return `这是第 ${variantIndex + 1}/${variantCount} 张候选图。必须保持同一主体结构和风格，但使用与其他候选明显不同的配色方案；不要只做轻微明暗变化。`;
}

export function buildImagePayload(
  request: GenerateImageRequest,
  config: FintopiaConfig,
  kind: EndpointKind,
  variantIndex = 0,
  variantCount = 1,
  options: { modelId?: string; googleProxy?: boolean } = {},
): Record<string, unknown> {
  const outputSize = buildOutputSize(request);
  const variantInstruction = buildVariantInstruction(variantIndex, variantCount);

  if (kind === "gemini-generate-content") {
    const imagesPerResponse = variantCount > 1 ? 1 : request.constraints.batchSize;
    const parts: Array<Record<string, unknown>> = [
      {
        text: [
          buildPrompt(request),
          variantInstruction,
          `输出比例：${request.constraints.aspectRatio}，实际 imageConfig.aspectRatio：${normalizeGeminiAspectRatio(request.constraints.aspectRatio)}。`,
          `输出清晰度：${request.constraints.resolution}，实际 imageConfig.imageSize：${request.constraints.resolution.toUpperCase()}。`,
          `只生成 ${imagesPerResponse} 张图片，不要在同一次响应里返回更多图片。`,
          "必须输出高清锐利图像，边缘清楚，局部细节可辨认，不要柔焦、虚化、糊边或低分辨率放大感。",
        ].join("\n\n"),
      },
    ];
    const referenceAssets = request.referenceAssets?.length ? request.referenceAssets : [request.inputAsset];

    for (const [index, asset] of referenceAssets.entries()) {
      const inlineData = asset.dataUrl ? dataUrlToInlineData(asset.dataUrl) : undefined;

      if (!inlineData) {
        continue;
      }

      parts.push({
        text: `${asset.referenceLabel || `图${index + 1}`} 参考图：${asset.filename}`,
      });
      parts.push({
        inlineData,
      });
    }

    const payload: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        responseModalities: options.googleProxy ? ["TEXT", "IMAGE"] : ["image"],
        imageConfig: {
          aspectRatio: normalizeGeminiAspectRatio(request.constraints.aspectRatio),
          imageSize: request.constraints.resolution.toUpperCase(),
        },
      },
    };

    if (options.modelId) {
      payload.model = options.modelId;
    }

    return payload;
  }

  if (kind === "chat-completions") {
    const text = [
      buildPrompt(request),
      variantInstruction,
      `输出比例：${request.constraints.aspectRatio}。`,
      `输出清晰度：${request.constraints.resolution}，目标像素尺寸：${outputSize.size}。`,
      "必须输出高清锐利图像，边缘清楚，局部细节可辨认，不要柔焦、虚化、糊边或低分辨率放大感。",
      `请基于参考图生成 ${request.constraints.batchSize} 张候选图片，直接返回生成图片，不要只返回文字说明。`,
    ].join("\n\n");
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text,
      },
    ];

    const referenceAssets = request.referenceAssets?.length ? request.referenceAssets : [request.inputAsset];

    for (const [index, asset] of referenceAssets.entries()) {
      if (!asset.dataUrl) {
        continue;
      }

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

    return {
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你是图像生成模型。必须严格遵守用户消息中的风格智能体规则、参考图编号和用户本轮要求；不要自行套用默认基础模板。",
        },
        {
          role: "user",
          content,
        },
      ],
      n: request.constraints.batchSize,
      size: outputSize.size,
      resolution: request.constraints.resolution.toUpperCase(),
      quality: request.constraints.resolution === "4k" ? "high" : "auto",
      stream: false,
    };
  }

  if (config.model === "gpt-image-2") {
    const payload: Record<string, unknown> = {
      prompt: [buildPrompt(request), variantInstruction].filter(Boolean).join("\n\n"),
      n: request.constraints.batchSize,
    };

    if (kind === "openai-images") {
      payload.model = config.model;
      payload.size = request.constraints.aspectRatio;
      payload.resolution = request.constraints.resolution.toUpperCase();
      payload.response_format = "url";
    } else {
      payload.size = outputSize.size;
      payload.quality = request.constraints.resolution === "4k" ? "high" : "auto";
    }

    return payload;
  }

  const payload: Record<string, unknown> = {
    prompt: [buildPrompt(request), variantInstruction].filter(Boolean).join("\n\n"),
    n: request.constraints.batchSize,
    size: outputSize.size,
    quality: request.constraints.resolution === "4k" ? "high" : "auto",
  };

  if (kind === "openai-images") {
    payload.model = config.model;
  }

  return payload;
}
