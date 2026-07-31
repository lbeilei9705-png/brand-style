import type { GenerateImageRequest } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";

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

export type EndpointKind = "azure-images" | "openai-images" | "chat-completions" | "gemini-generate-content";

export interface EndpointAttempt {
  endpoint: string;
  kind: EndpointKind;
  timeoutMs: number;
  /** Bearer token auth (Supabase gemini-proxy). When set, skip Yunwu `?key=` query auth. */
  bearerToken?: string;
  /** GA model id for Google proxy (preview ids are mapped). */
  modelId?: string;
  /** Build Google Vertex-compatible generateContent payload. Preferred channel for Nano2/Pro. */
  googleProxy?: boolean;
  label?: string;
}

const DEFAULT_GEMINI_PROXY_BASE = "https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy";

/** Preview image model IDs retired on Vertex; map to GA ids for Google proxy. */
const GOOGLE_IMAGE_MODEL_ALIASES: Record<string, string> = {
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
  "gemini-3.1-flash-image": "gemini-3.1-flash-image",
  "gemini-3-pro-image": "gemini-3-pro-image",
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  const base = trimTrailingSlash(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function resolveGoogleGeminiProxyBase(): string {
  const explicit = (process.env.GOOGLE_GEMINI_PROXY_URL || "").trim();

  if (explicit) {
    return trimTrailingSlash(explicit);
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();

  if (supabaseUrl) {
    return `${trimTrailingSlash(supabaseUrl)}/functions/v1/gemini-proxy`;
  }

  return DEFAULT_GEMINI_PROXY_BASE;
}

function normalizeGoogleImageModelId(model: string): string | undefined {
  return GOOGLE_IMAGE_MODEL_ALIASES[(model || "").trim()];
}

function isGoogleNanoImageModel(config: FintopiaConfig): boolean {
  return Boolean(normalizeGoogleImageModelId(config.model));
}

function buildGoogleProxyAttempt(config: FintopiaConfig): EndpointAttempt | undefined {
  const googleModel = normalizeGoogleImageModelId(config.model);
  const googleToken = (process.env.GOOGLE_API_TOKEN || "").trim();

  if (!isGoogleNanoImageModel(config) || !googleModel || !googleToken) {
    return undefined;
  }

  const encodedModel = encodeURIComponent(googleModel);

  return {
    endpoint: `${resolveGoogleGeminiProxyBase()}/${encodedModel}:generateContent`,
    kind: "gemini-generate-content",
    timeoutMs: 300000,
    bearerToken: googleToken,
    modelId: googleModel,
    googleProxy: true,
    label: "google-gemini-proxy",
  };
}

export function buildEndpointAttempts(config: FintopiaConfig): EndpointAttempt[] {
  const googlePrimary = buildGoogleProxyAttempt(config);

  // Nano2 / Nano Pro should only use Google gemini-proxy. Do not fall back to
  // retired Yunwu preview endpoints, because they hide the real proxy error.
  if (isGoogleNanoImageModel(config)) {
    return googlePrimary ? [googlePrimary] : [];
  }

  const base = trimTrailingSlash(config.apiUrl);
  const encodedModel = encodeURIComponent(config.model);
  const apiStyle = config.apiStyle || "azure";
  const configuredAttempts: EndpointAttempt[] = [];

  if (config.apiPath) {
    const endpoint = joinUrl(base, config.apiPath.replace("{model}", encodedModel));
    const kind = config.apiPath.includes(":generateContent")
      ? "gemini-generate-content"
      : config.apiPath.includes("/chat/completions")
        ? "chat-completions"
        : "openai-images";
    configuredAttempts.push({
      endpoint: config.version ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(config.version)}` : endpoint,
      kind,
      timeoutMs: kind === "chat-completions" || kind === "gemini-generate-content" ? 300000 : 180000,
      label: "primary",
    });
  } else if (apiStyle === "openai" || apiStyle === "custom") {
    configuredAttempts.push({
      endpoint: joinUrl(base, "/v1/images/generations"),
      kind: "openai-images",
      timeoutMs: 180000,
      label: "primary",
    });
  } else {
    const endpoint = `${base}/openai/deployments/${encodedModel}/images/generations`;
    const azureEndpoint = config.version ? `${endpoint}?api-version=${encodeURIComponent(config.version)}` : endpoint;

    configuredAttempts.push({
      endpoint: azureEndpoint,
      kind: "azure-images",
      timeoutMs: 180000,
      label: "primary",
    });
  }

  return configuredAttempts;
}

export function getEndpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint;
  }
}

export function logProviderInfo(message: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    level: "info",
    scope: "image-provider",
    message,
    time: new Date().toISOString(),
    ...details,
  }));
}

export function logProviderError(message: string, details: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({
    level: "error",
    scope: "image-provider",
    message,
    time: new Date().toISOString(),
    ...details,
  }));
}

function truncateText(value: string | undefined, maxLength = 1200): string {
  const text = String(value || "");

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function summarizeGenerateRequest(request: GenerateImageRequest, config: FintopiaConfig): Record<string, unknown> {
  const candidates = request.referenceAssets?.length ? request.referenceAssets : [request.inputAsset];
  const references = candidates.filter((asset) => asset.mimeType.startsWith("image/") && Boolean(asset.dataUrl));

  return {
    taskId: request.taskId,
    provider: "fintopia",
    model: config.model,
    apiStyle: config.apiStyle || "azure",
    apiPath: config.apiPath || "",
    hasApiKey: Boolean(config.apiKey),
    inputAsset: {
      filename: request.inputAsset.filename,
      mimeType: request.inputAsset.mimeType,
      sizeBytes: request.inputAsset.sizeBytes,
      width: request.inputAsset.width,
      height: request.inputAsset.height,
    },
    referenceAssets: references.map((asset) => ({
      referenceLabel: asset.referenceLabel,
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
    })),
    constraints: request.constraints,
    prompt: {
      positive: truncateText(request.prompt.positive),
      negative: truncateText(request.prompt.negative, 600),
      template: request.prompt.template,
    },
  };
}
