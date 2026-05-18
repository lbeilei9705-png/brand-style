import type { GeneratedImage, GenerateImageRequest } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";
import type { ImageProvider } from "./imageProvider.ts";

interface FintopiaImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  images?: Array<{
    b64_json?: string;
    b64?: string;
    url?: string;
  }>;
  choices?: Array<{
    message?: {
      content?: unknown;
      images?: unknown;
    };
  }>;
  candidates?: Array<{
    content?: {
      parts?: unknown;
    };
  }>;
  error?: {
    message?: string;
  } | string;
}

type EndpointKind = "azure-images" | "openai-images" | "chat-completions" | "gemini-generate-content";

interface EndpointAttempt {
  endpoint: string;
  kind: EndpointKind;
  timeoutMs: number;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  const base = trimTrailingSlash(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function buildEndpointAttempts(config: FintopiaConfig): EndpointAttempt[] {
  const base = trimTrailingSlash(config.apiUrl);
  const encodedModel = encodeURIComponent(config.model);
  const apiStyle = config.apiStyle || "azure";

  if (config.apiPath) {
    const endpoint = joinUrl(base, config.apiPath.replace("{model}", encodedModel));
    const kind = config.apiPath.includes(":generateContent")
      ? "gemini-generate-content"
      : config.apiPath.includes("/chat/completions")
        ? "chat-completions"
        : "openai-images";
    return [{
      endpoint: config.version ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(config.version)}` : endpoint,
      kind,
      timeoutMs: kind === "chat-completions" || kind === "gemini-generate-content" ? 300000 : 180000,
    }];
  }

  if (apiStyle === "openai") {
    return [{
      endpoint: joinUrl(base, "/v1/images/generations"),
      kind: "openai-images",
      timeoutMs: 180000,
    }];
  }

  if (apiStyle === "custom") {
    return [{
      endpoint: joinUrl(base, "/v1/images/generations"),
      kind: "openai-images",
      timeoutMs: 180000,
    }];
  }

  const endpoint = `${base}/openai/deployments/${encodedModel}/images/generations`;
  const azureEndpoint = config.version ? `${endpoint}?api-version=${encodeURIComponent(config.version)}` : endpoint;

  return [{
    endpoint: azureEndpoint,
    kind: "azure-images",
    timeoutMs: 180000,
  }];
}

function getEndpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint;
  }
}

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

function buildHeaders(apiKey: string, kind: EndpointKind): HeadersInit {
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

async function getActualImageSize(imageUrl: string): Promise<{ width: number; height: number } | undefined> {
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

function buildOutputSize(request: GenerateImageRequest): { width: number; height: number; size: string } {
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

function buildImagePayload(request: GenerateImageRequest, config: FintopiaConfig, kind: EndpointKind): Record<string, unknown> {
  const outputSize = buildOutputSize(request);

  if (kind === "gemini-generate-content") {
    const parts: Array<Record<string, unknown>> = [
      {
        text: [
          buildPrompt(request),
          `输出比例：${request.constraints.aspectRatio}，实际 imageConfig.aspectRatio：${normalizeGeminiAspectRatio(request.constraints.aspectRatio)}。`,
          `输出清晰度：${request.constraints.resolution}，实际 imageConfig.imageSize：${request.constraints.resolution.toUpperCase()}。`,
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

    return {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        responseModalities: ["image"],
        imageConfig: {
          aspectRatio: normalizeGeminiAspectRatio(request.constraints.aspectRatio),
          imageSize: request.constraints.resolution.toUpperCase(),
        },
      },
    };
  }

  if (kind === "chat-completions") {
    const text = [
      buildPrompt(request),
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
      prompt: buildPrompt(request),
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
    prompt: buildPrompt(request),
    n: request.constraints.batchSize,
    size: outputSize.size,
    quality: request.constraints.resolution === "4k" ? "high" : "auto",
  };

  if (kind === "openai-images") {
    payload.model = config.model;
  }

  return payload;
}

function parseImageUrl(item: { b64_json?: string; url?: string }): string {
  if (item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }

  if (item.url) {
    return item.url;
  }

  throw new Error("生图接口响应中没有 b64_json 或 url。");
}

function asImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  if (/^https?:\/\//.test(trimmed)) {
    return trimmed;
  }

  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 200) {
    return `data:image/png;base64,${trimmed}`;
  }

  return undefined;
}

function collectImageUrlsFromUnknown(value: unknown, urls: string[]): void {
  const directUrl = asImageUrl(value);

  if (directUrl) {
    urls.push(directUrl);
    return;
  }

  if (typeof value === "string") {
    const dataUrlMatches = value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g) || [];
    const markdownUrlMatches = [...value.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)].map((match) => match[1]);
    const httpUrlMatches = value.match(/https?:\/\/[^\s)"']+/g) || [];

    for (const candidate of [...dataUrlMatches, ...markdownUrlMatches, ...httpUrlMatches]) {
      const parsed = asImageUrl(candidate);

      if (parsed) {
        urls.push(parsed);
      }
    }

    try {
      collectImageUrlsFromUnknown(JSON.parse(value), urls);
    } catch {
      // Text responses are common; JSON parsing is only a best-effort fallback.
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageUrlsFromUnknown(item, urls);
    }
    return;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (record.inlineData && typeof record.inlineData === "object") {
      const inline = record.inlineData as { mimeType?: string; data?: string };

      if (inline.data) {
        urls.push(`data:${inline.mimeType || "image/png"};base64,${inline.data}`);
        return;
      }
    }

    collectImageUrlsFromUnknown(record.url, urls);
    collectImageUrlsFromUnknown(record.imageUrl, urls);
    collectImageUrlsFromUnknown(record.image_url, urls);
    collectImageUrlsFromUnknown(record.inlineData, urls);
    collectImageUrlsFromUnknown(record.b64_json, urls);
    collectImageUrlsFromUnknown(record.b64, urls);
    collectImageUrlsFromUnknown(record.data, urls);
    collectImageUrlsFromUnknown(record.images, urls);
    collectImageUrlsFromUnknown(record.content, urls);
  }
}

function collectImageUrls(payload: FintopiaImageResponse): string[] {
  const urls: string[] = [];

  for (const item of payload.data || []) {
    urls.push(parseImageUrl(item));
  }

  for (const item of payload.images || []) {
    urls.push(parseImageUrl({
      b64_json: item.b64_json || item.b64,
      url: item.url,
    }));
  }

  for (const choice of payload.choices || []) {
    collectImageUrlsFromUnknown(choice.message?.images, urls);
    collectImageUrlsFromUnknown(choice.message?.content, urls);
  }

  for (const candidate of payload.candidates || []) {
    collectImageUrlsFromUnknown(candidate.content?.parts, urls);
  }

  return [...new Set(urls)];
}

function getErrorMessage(payload: FintopiaImageResponse): string | undefined {
  if (typeof payload.error === "string") {
    return payload.error;
  }

  return payload.error?.message;
}

export class FintopiaImageProvider implements ImageProvider {
  private readonly config: FintopiaConfig;

  constructor(config: FintopiaConfig) {
    this.config = config;
  }

  async generate(request: GenerateImageRequest): Promise<GeneratedImage[]> {
    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error("当前模型缺少 API URL 或 API Key。请在模型管理中补齐配置。");
    }

    const attempts = buildEndpointAttempts(this.config);
    let response: Response | undefined;
    const failures: string[] = [];

    for (const attempt of attempts) {
      const endpoint = attempt.kind === "gemini-generate-content"
        ? `${attempt.endpoint}${attempt.endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.config.apiKey)}`
        : attempt.endpoint;
      const endpointLabel = getEndpointLabel(endpoint);

      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: buildHeaders(this.config.apiKey, attempt.kind),
          body: JSON.stringify(buildImagePayload(request, this.config, attempt.kind)),
          signal: AbortSignal.timeout(attempt.timeoutMs),
        });

        if (!response.ok && attempts.indexOf(attempt) < attempts.length - 1) {
          let errorMessage = `HTTP ${response.status}`;

          try {
            const failedPayload = await response.clone().json() as FintopiaImageResponse;
            errorMessage = getErrorMessage(failedPayload) || errorMessage;
          } catch {
            // Some gateways return empty/non-JSON errors; keep the HTTP status.
          }

          failures.push(`${endpointLabel}：${errorMessage}`);
          response = undefined;
          continue;
        }

        break;
      } catch (error) {
        const cause = error instanceof Error && "cause" in error
          ? (error.cause as { code?: string; message?: string } | undefined)
          : undefined;
        const rawDetail = cause?.code || cause?.message || (error instanceof Error ? error.message : "unknown network error");
        const detail = rawDetail.includes("aborted") || rawDetail.includes("timeout")
          ? `请求超过 ${Math.round(attempt.timeoutMs / 1000)} 秒仍未返回，已自动中断`
          : rawDetail;

        failures.push(`${endpointLabel}：${detail}`);
      }
    }

    if (!response) {
      throw new Error(`无法连接当前模型接口：${failures.join("；")}。请确认中转站地址、模型名、网络/VPN/代理或服务白名单后重试。`);
    }

    const payload = await response.json() as FintopiaImageResponse;

    if (!response.ok) {
      const endpointLabel = getEndpointLabel(response.url);
      throw new Error(`${endpointLabel} 请求失败：${getErrorMessage(payload) || `HTTP 状态码 ${response.status}`}。`);
    }

    const imageUrls = collectImageUrls(payload);

    if (!imageUrls.length) {
      throw new Error("当前模型接口响应中没有解析到图片。如果你使用的是 /v1/chat/completions 中转站，请确认该模型会在 message.content 或 message.images 中返回图片 URL/base64。");
    }

    const outputSize = buildOutputSize(request);
    const actualSizes = await Promise.all(imageUrls.map((imageUrl) => getActualImageSize(imageUrl)));

    return imageUrls.map((imageUrl, index) => ({
      id: `fintopia_${index + 1}`,
      imageUrl,
      width: actualSizes[index]?.width || outputSize.width,
      height: actualSizes[index]?.height || outputSize.height,
      seed: Date.now() + index,
      provider: "fintopia",
    }));
  }
}
