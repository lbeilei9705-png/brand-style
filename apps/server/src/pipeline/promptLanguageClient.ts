import type { ModelConfig } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveGoogleGeminiProxyBase(model?: ModelConfig): string {
  const explicit = (model?.apiUrl || process.env.GOOGLE_GEMINI_PROXY_URL || "").trim();

  if (explicit) {
    return trimTrailingSlash(explicit);
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "https://zbhvoeakhrvzahmmades.supabase.co").trim();
  return `${trimTrailingSlash(supabaseUrl)}/functions/v1/gemini-proxy`;
}

function isGoogleGeminiProxyModel(model: ModelConfig): boolean {
  return (model.apiUrl || "").includes("/functions/v1/gemini-proxy")
    || model.id === "gemini-3-1-pro";
}

export function buildEndpoint(model: ModelConfig, fallback?: FintopiaConfig): string {
  if (isGoogleGeminiProxyModel(model)) {
    return resolveGoogleGeminiProxyBase(model);
  }

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

export function buildHeaders(model: ModelConfig, fallback?: FintopiaConfig): HeadersInit {
  const apiKey = model.apiKey || fallback?.apiKey || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (isGoogleGeminiProxyModel(model)) {
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  if ((model.apiStyle || fallback?.apiStyle || "azure") === "azure" && !model.apiPath) {
    headers["api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

export function buildLanguagePayload(model: ModelConfig, systemPrompt: string, userContent: unknown, temperature: number): Record<string, unknown> {
  if (isGoogleGeminiProxyModel(model)) {
    const contentText = typeof userContent === "string"
      ? userContent
      : JSON.stringify(userContent);

    return {
      model: model.model,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: contentText }],
        },
      ],
      generationConfig: {
        temperature,
      },
    };
  }

  return {
    model: model.apiStyle === "azure" ? undefined : model.model,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    temperature,
  };
}

export function extractLanguageText(payload: ChatCompletionResponse): string {
  const chatContent = payload.choices?.[0]?.message?.content;

  if (chatContent) {
    return chatContent;
  }

  const candidates = (payload as unknown as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  }).candidates;
  const parts = candidates?.[0]?.content?.parts || [];

  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function extractJsonObject<T>(content: string): T | undefined {
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

export function getReadableLanguageModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");

  if (/fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|timeout|TLS|certificate/i.test(message)) {
    return "语言模型服务暂时无法访问，请检查 Fintopia GPT 5.5 服务、API Key 或 Render 到模型服务的网络连接。";
  }

  return message || "语言模型请求失败。";
}
