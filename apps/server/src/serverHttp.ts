import fs from "fs";
import type http from "http";
import path from "path";
import { fileURLToPath } from "url";
import type { CreateTaskRequest, InputType, OutputTarget } from "../../../packages/shared/src/index.ts";
import { parseMultipart, readRequestBody } from "./http/multipart.ts";
import { send, sendJson } from "./http/response.ts";
import type { OssAssetStorage } from "./storage/ossAssetStorage.ts";
import type { TaskService } from "./taskService.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "../../web/public");
let adminAccessToken = "";
let pluginRateLimit = 10;
let pluginRateLimitWindowMs = 60_000;
let pluginGlobalRateLimit = 60;

export function configureServerHttp(): void {
  adminAccessToken = process.env.BRAND_STYLE_ADMIN_TOKEN
    || process.env.BRAND_STYLE_ACCESS_TOKEN
    || "";
  pluginRateLimit = Math.max(1, Number(process.env.BRAND_STYLE_PLUGIN_RATE_LIMIT || 10));
  pluginRateLimitWindowMs = Math.max(
    1_000,
    Number(process.env.BRAND_STYLE_PLUGIN_RATE_WINDOW_MS || 60_000),
  );
  pluginGlobalRateLimit = Math.max(
    pluginRateLimit,
    Number(process.env.BRAND_STYLE_PLUGIN_GLOBAL_RATE_LIMIT || 60),
  );
}

export function logInfo(scope: string, message: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    level: "info",
    scope,
    message,
    time: new Date().toISOString(),
    ...details,
  }));
}

export function logError(scope: string, message: string, details: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({
    level: "error",
    scope,
    message,
    time: new Date().toISOString(),
    ...details,
  }));
}

function summarizeTaskRequest(request: CreateTaskRequest): Record<string, unknown> {
  return {
    inputType: request.inputType,
    source: request.source,
    target: request.target,
    filename: request.filename,
    mimeType: request.mimeType,
    sizeBytes: request.sizeBytes,
    hasAssetDataUrl: Boolean(request.assetDataUrl),
    referenceAssetCount: request.referenceAssets?.length || 0,
    stylePresetId: request.stylePresetId || "",
    hasMaterialPrompt: Boolean(request.materialPrompt),
    hasColorPrompt: Boolean(request.colorPrompt),
    hasShapeArchitecturePrompt: Boolean(request.shapeArchitecturePrompt),
    hasOperationScenarioPrompt: Boolean(request.operationScenarioPrompt),
    usePromptOrchestrator: request.usePromptOrchestrator,
    constraints: request.constraints,
  };
}

export function stripModelSecret<T extends { apiKey?: string }>(model: T): Omit<T, "apiKey"> {
  const { apiKey: _apiKey, ...safeModel } = model;

  return safeModel;
}

export function stripPublicModel<T extends {
  id: string;
  name: string;
  enabled: boolean;
  purpose?: string;
}>(model: T): Pick<T, "id" | "name" | "enabled" | "purpose"> {
  return {
    id: model.id,
    name: model.name,
    enabled: model.enabled,
    purpose: model.purpose,
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value === "true";
}

function normalizeCreateTaskRequest(body: unknown): CreateTaskRequest {
  const raw = body as Record<string, unknown>;

  return {
    inputType: String(raw.inputType || "auto") as InputType,
    stylePresetId: typeof raw.stylePresetId === "string" ? raw.stylePresetId : "",
    source: raw.source === "figma_selection" ? "figma_selection" : "web_upload",
    filename: String(raw.filename || "untitled-input"),
    mimeType: String(raw.mimeType || "application/octet-stream"),
    sizeBytes: Number(raw.sizeBytes || 0),
    assetDataUrl: typeof raw.assetDataUrl === "string" ? raw.assetDataUrl : undefined,
    materialPrompt: typeof raw.materialPrompt === "string" ? raw.materialPrompt : undefined,
    colorPrompt: typeof raw.colorPrompt === "string" ? raw.colorPrompt : undefined,
    target: raw.target === "figma" ? "figma" : "web",
    constraints: {
      preserveStructure: raw.preserveStructure === undefined ? true : Boolean(raw.preserveStructure),
      styleLock: raw.styleLock === undefined ? true : Boolean(raw.styleLock),
      transparentBackground: raw.transparentBackground === undefined ? true : Boolean(raw.transparentBackground),
      fidelityLevel: raw.fidelityLevel === "strict" ? "strict" : "balanced",
      variationStrength: raw.variationStrength === "low" ? "low" : "medium",
      batchSize: Number(raw.batchSize || 1),
      aspectRatio: String(raw.aspectRatio || "1:1") as CreateTaskRequest["constraints"]["aspectRatio"],
      resolution: String(raw.resolution || "1k") as CreateTaskRequest["constraints"]["resolution"],
    },
  };
}

function normalizeMultipartCreateTaskRequest(req: http.IncomingMessage, body: Buffer): CreateTaskRequest {
  const parsed = parseMultipart(body, req.headers["content-type"] || "");
  const asset = parsed.files.asset;

  return {
    inputType: String(parsed.fields.inputType || "auto") as InputType,
    stylePresetId: parsed.fields.stylePresetId || "",
    source: (parsed.fields.source === "figma_selection" ? "figma_selection" : "web_upload") as CreateTaskRequest["source"],
    filename: asset?.filename || parsed.fields.filename || "untitled-input",
    mimeType: asset?.mimeType || parsed.fields.mimeType || "application/octet-stream",
    sizeBytes: asset?.sizeBytes || Number(parsed.fields.sizeBytes || 0),
    assetDataUrl: asset?.dataUrl || parsed.fields.assetDataUrl,
    materialPrompt: parsed.fields.materialPrompt,
    colorPrompt: parsed.fields.colorPrompt,
    target: (parsed.fields.target === "figma" ? "figma" : "web") as OutputTarget,
    constraints: {
      preserveStructure: parseBoolean(parsed.fields.preserveStructure, true),
      styleLock: parseBoolean(parsed.fields.styleLock, true),
      transparentBackground: parseBoolean(parsed.fields.transparentBackground, true),
      fidelityLevel: parsed.fields.fidelityLevel === "strict" ? "strict" : "balanced",
      variationStrength: parsed.fields.variationStrength === "low" ? "low" : "medium",
      batchSize: Number(parsed.fields.batchSize || 1),
      aspectRatio: (parsed.fields.aspectRatio || "1:1") as CreateTaskRequest["constraints"]["aspectRatio"],
      resolution: (parsed.fields.resolution || "1k") as CreateTaskRequest["constraints"]["resolution"],
    },
  };
}

export async function readJsonRequest(req: http.IncomingMessage): Promise<unknown> {
  const body = await readRequestBody(req);

  if (!body.length) {
    return {};
  }

  return JSON.parse(body.toString("utf8"));
}

export async function handleCreateTask(req: http.IncomingMessage, res: http.ServerResponse, taskService: TaskService): Promise<void> {
  const contentType = req.headers["content-type"] || "";
  const request = contentType.startsWith("multipart/form-data")
    ? normalizeMultipartCreateTaskRequest(req, await readRequestBody(req))
    : normalizeCreateTaskRequest(await readJsonRequest(req));
  logInfo("task", "create task request", summarizeTaskRequest(request));
  const response = await taskService.createTask(request);
  logInfo("task", "create task completed", {
    taskId: response.taskId,
    resultCount: response.task.results.length,
    selectedResultId: response.task.selectedResultId,
  });

  sendJson(res, 201, response);
}

export async function handleAssetUpload(req: http.IncomingMessage, res: http.ServerResponse, assetStorage: OssAssetStorage): Promise<void> {
  const parsed = parseMultipart(await readRequestBody(req), req.headers["content-type"] || "");
  const asset = parsed.files.asset;

  if (!asset) {
    sendJson(res, 400, { error: "缺少 asset 文件字段。" });
    return;
  }

  const uploaded = await assetStorage.upload({
    category: parsed.fields.category || "admin",
    filename: asset.filename || "asset.png",
    mimeType: asset.mimeType || "application/octet-stream",
    buffer: asset.buffer,
  });
  logInfo("asset", "asset uploaded", {
    category: parsed.fields.category || "admin",
    filename: asset.filename,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    objectKey: uploaded.objectKey,
    url: uploaded.url,
  });

  sendJson(res, 201, { asset: uploaded });
}

export function redirectOssAsset(pathname: string, res: http.ServerResponse, assetStorage: OssAssetStorage): boolean {
  const prefix = "/assets/oss/";

  if (!pathname.startsWith(prefix)) {
    return false;
  }

  const objectKey = decodeURIComponent(pathname.slice(prefix.length));

  try {
    res.writeHead(302, {
      Location: assetStorage.getSignedUrl(objectKey),
      "Cache-Control": "private, max-age=300",
    });
    res.end();
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "生成 OSS 访问地址失败。",
    });
  }

  return true;
}

export function serveStatic(pathname: string, res: http.ServerResponse): void {
  const routeAliases: Record<string, string> = {
    "/": "/showcase.html",
    "/debug-prompt": "/debug-prompt.html",
    "/figma-ai": "/figma-ai.html",
    "/figma-cover": "/figma-cover.html",
    "/figma-page2": "/figma-page2.html",
    "/figma-page3": "/figma-page3.html",
    "/figma-page4": "/figma-page4.html",
    "/figma-page5": "/figma-page5.html",
    "/figma-page6": "/figma-page6.html",
    "/figma-page7": "/figma-page7.html",
    "/figma-page8": "/figma-page8.html",
    "/figma-page9": "/figma-page9.html",
    "/figma-page10": "/figma-page10.html",
    "/figma-page11": "/figma-page11.html",
    "/figma-page12": "/figma-page12.html",
    "/figma-page13": "/figma-page13.html",
    "/figma-page14": "/figma-page14.html",
    "/figma-page15": "/figma-page15.html",
    "/figma-page16": "/figma-page16.html",
    "/figma-page17": "/figma-page17.html",
    "/figma-page18": "/figma-page18.html",
    "/figma-page19": "/figma-page19.html",
    "/figma-page20": "/figma-page20.html",
    "/figma-page21": "/figma-page21.html",
    "/figma-page22": "/figma-page22.html",
    "/figma-page23": "/figma-page23.html",
    "/figma-page24": "/figma-page24.html",
    "/figma-page25": "/figma-page25.html",
    "/figma-ppt": "/figma-ppt.html",
    "/showcase": "/showcase.html",
  };
  const safePath = routeAliases[pathname] || pathname;
  const filePath = path.resolve(webDir, `.${safePath}`);

  if (!filePath.startsWith(webDir)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".css": "text/css; charset=utf-8",
      ".gif": "image/gif",
      ".html": "text/html; charset=utf-8",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".js": "application/javascript; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml; charset=utf-8",
      ".webp": "image/webp",
    };
    const contentType = contentTypes[ext] || "application/octet-stream";

    send(res, 200, content, contentType);
  });
}

export function isAuthorizedRequest(req: http.IncomingMessage): boolean {
  return hasAdminCredentials(req);
}

export function hasAdminCredentials(req: http.IncomingMessage): boolean {
  return Boolean(adminAccessToken)
    && req.headers["x-brand-style-token"] === adminAccessToken;
}

const protectedPluginGetRoutes = new Set([
  "/api/style-presets",
  "/api/config/models",
  "/api/config/style-skills",
  "/api/config/materials",
  "/api/config/color-palettes",
  "/api/config/shape-architectures",
  "/api/config/operation-scenarios",
  "/api/config/scenario-agents",
  "/api/member/session/me",
]);

export function isProtectedPluginRequest(method: string | undefined, pathname: string): boolean {
  if (method === "GET") {
    return protectedPluginGetRoutes.has(pathname);
  }

  if (method === "POST") {
    return pathname === "/api/conversations"
      || pathname === "/api/scenario-agent/complete"
      || /^\/api\/conversations\/conv_[0-9a-f-]{36}\/messages$/i.test(pathname);
  }

  return method === "DELETE"
    && (
      pathname === "/api/member/session"
      || /^\/api\/conversations\/conv_[0-9a-f-]{36}$/i.test(pathname)
    );
}

export function getMemberToken(req: http.IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length).trim();
}

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

const pluginRateLimitWindows = new Map<string, RateLimitWindow>();
let pluginGlobalRateLimitWindow: RateLimitWindow | undefined;

function getClientAddress(req: http.IncomingMessage): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const forwardedAddresses = forwardedAddress
    ?.split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  return forwardedAddresses?.at(-1) || req.socket.remoteAddress || "unknown";
}

export function consumePluginRateLimit(req: http.IncomingMessage): number {
  const now = Date.now();
  const activeGlobalWindow = pluginGlobalRateLimitWindow?.resetAt
    && pluginGlobalRateLimitWindow.resetAt > now
    ? pluginGlobalRateLimitWindow
    : undefined;

  if (activeGlobalWindow && activeGlobalWindow.count >= pluginGlobalRateLimit) {
    return Math.max(1, Math.ceil((activeGlobalWindow.resetAt - now) / 1_000));
  }

  if (pluginRateLimitWindows.size > 10_000) {
    for (const [key, window] of pluginRateLimitWindows) {
      if (window.resetAt <= now) {
        pluginRateLimitWindows.delete(key);
      }
    }
  }

  const key = getClientAddress(req);
  const current = pluginRateLimitWindows.get(key);
  const activeClientWindow = current?.resetAt && current.resetAt > now
    ? current
    : undefined;

  if (activeClientWindow && activeClientWindow.count >= pluginRateLimit) {
    return Math.max(1, Math.ceil((activeClientWindow.resetAt - now) / 1_000));
  }

  if (activeGlobalWindow) {
    activeGlobalWindow.count += 1;
  } else {
    pluginGlobalRateLimitWindow = {
      count: 1,
      resetAt: now + pluginRateLimitWindowMs,
    };
  }

  if (activeClientWindow) {
    activeClientWindow.count += 1;
  } else {
    pluginRateLimitWindows.set(key, {
      count: 1,
      resetAt: now + pluginRateLimitWindowMs,
    });
  }

  return 0;
}
