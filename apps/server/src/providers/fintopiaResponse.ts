interface FintopiaImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  images?: Array<{ b64_json?: string; b64?: string; url?: string }>;
  choices?: Array<{ message?: { content?: unknown; images?: unknown } }>;
  candidates?: Array<{ content?: { parts?: unknown } }>;
  error?: { message?: string } | string;
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

export function collectImageUrls(payload: FintopiaImageResponse): string[] {
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

export function getErrorMessage(payload: FintopiaImageResponse): string | undefined {
  if (typeof payload.error === "string") {
    return payload.error;
  }

  return payload.error?.message;
}
