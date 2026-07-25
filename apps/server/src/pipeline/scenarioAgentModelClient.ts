import type { ModelConfig } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";

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
  const apiKey = model.apiKey || (model.apiUrl ? "" : fallback?.apiKey) || "";
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

export function buildLanguagePayload(model: ModelConfig, systemPrompt: string, userContent: string): Record<string, unknown> {
  if (isGoogleGeminiProxyModel(model)) {
    return {
      model: model.model,
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userContent }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    };
  }

  return {
    model: model.apiStyle === "azure" ? undefined : model.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
  };
}

export function extractLanguageText(payload: Record<string, unknown>): string {
  const choices = payload.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const chatContent = choices?.[0]?.message?.content;

  if (typeof chatContent === "string") {
    return chatContent;
  }

  const candidates = payload.candidates as Array<{ content?: { parts?: Array<{ text?: unknown }> } }> | undefined;
  const parts = candidates?.[0]?.content?.parts || [];

  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function getReadableLanguageModelError(error: unknown, model?: ModelConfig): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const modelName = model?.name || model?.model || "语言模型";

  if (/fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|timeout|TLS|certificate/i.test(message)) {
    return `场景智能体暂时无法访问「${modelName}」，请检查该模型服务、API Key 或 Render 到模型服务的网络连接。`;
  }

  return message || "场景智能体调用语言模型失败。";
}

export function extractJsonObject(content: string): Record<string, unknown> | undefined {
  const cleanContent = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleanContent);
  } catch {
    const match = cleanContent.match(/\{[\s\S]*\}/);
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

export function extractMarkdownSection(content: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sameLineMatch = content.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*([^\\n]+)`, "i"));

  if (sameLineMatch?.[1]?.trim()) {
    return sameLineMatch[1].trim();
  }

  const blockMatch = content.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?prompt[_-](?:main|negative)(?:\\*\\*)?\\s*[:：]?\\s*(?:\\n|$)|$)`, "i"));

  return blockMatch?.[1]?.trim();
}

export function getStringField(value: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const field = value?.[key];

    if (typeof field === "string" && field.trim()) {
      return field.trim();
    }
  }

  return undefined;
}

export function buildMiniatureWorldPrompt(parsedOutput: Record<string, unknown> | undefined, rawOutput: string): string {
  const modelPrompt = getStringField(parsedOutput, ["finalPrompt", "final_prompt", "prompt_main", "promptMain"]);

  if (modelPrompt) {
    return modelPrompt;
  }

  const sceneModules = Array.isArray(parsedOutput?.sceneModules)
    ? parsedOutput.sceneModules.map((item) => String(item)).filter(Boolean)
    : [];
  const layoutDescription = Array.isArray(parsedOutput?.layoutDescription)
    ? parsedOutput.layoutDescription.map((item) => String(item)).filter(Boolean)
    : [];
  const fallbackSceneText = [
    getStringField(parsedOutput, ["topicAnalysis", "topic_analysis"]),
    getStringField(parsedOutput, ["spatialArchetype", "spatial_archetype"]),
    getStringField(parsedOutput, ["surfaceDecision", "surface_decision"]),
    ...layoutDescription,
    ...sceneModules,
  ].filter(Boolean).join("\n");
  const sceneText = fallbackSceneText || rawOutput.trim();

  return sceneText;
}
