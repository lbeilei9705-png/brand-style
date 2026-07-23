import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { stylePresets } from "../../../packages/shared/src/index.ts";
import type { CreateTaskRequest, InputType, OutputTarget } from "../../../packages/shared/src/index.ts";
import { importAgentFromMarkdown } from "./agentMarkdownImporter.ts";
import { getAppConfig, loadDotEnv } from "./config.ts";
import { ConfigStore, type StoredConfig } from "./configStore.ts";
import { ConversationService } from "./conversationService.ts";
import { ConversationStore } from "./conversationStore.ts";
import { parseMultipart, readRequestBody } from "./http/multipart.ts";
import { send, sendJson } from "./http/response.ts";
import { FintopiaImageProvider } from "./providers/fintopiaImageProvider.ts";
import { MockImageProvider } from "./providers/mockImageProvider.ts";
import { OssAssetStorage } from "./storage/ossAssetStorage.ts";
import { SupabaseConfigStore } from "./storage/supabaseConfigStore.ts";
import { TaskService } from "./taskService.ts";
import { TaskStore } from "./taskStore.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
loadDotEnv(projectRoot);
const appConfig = getAppConfig();
const port = Number(process.env.PORT || 5180);
const adminAccessToken = process.env.BRAND_STYLE_ADMIN_TOKEN
  || process.env.BRAND_STYLE_ACCESS_TOKEN
  || "";
const pluginRateLimit = Math.max(1, Number(process.env.BRAND_STYLE_PLUGIN_RATE_LIMIT || 10));
const pluginRateLimitWindowMs = Math.max(
  1_000,
  Number(process.env.BRAND_STYLE_PLUGIN_RATE_WINDOW_MS || 60_000),
);
const pluginGlobalRateLimit = Math.max(
  pluginRateLimit,
  Number(process.env.BRAND_STYLE_PLUGIN_GLOBAL_RATE_LIMIT || 60),
);
const conversationRetentionDays = Math.max(
  1,
  Number(process.env.BRAND_STYLE_CONVERSATION_RETENTION_DAYS || 30),
);
const webDir = path.resolve(__dirname, "../../web/public");
const dataDir = path.resolve(projectRoot, "data");
const remoteConfigStore = appConfig.supabase
  ? new SupabaseConfigStore<StoredConfig>({
    url: appConfig.supabase.url,
    serviceRoleKey: appConfig.supabase.serviceRoleKey,
    tableName: appConfig.supabase.tableName,
  })
  : undefined;
const configStore = new ConfigStore(dataDir, remoteConfigStore);
await configStore.syncFromRemote().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
});
const conversationStore = new ConversationStore(dataDir, conversationRetentionDays);
conversationStore.list();
const conversationCleanupTimer = setInterval(() => {
  conversationStore.list();
}, 24 * 60 * 60 * 1_000);
conversationCleanupTimer.unref();
const store = new TaskStore();
const assetStorage = new OssAssetStorage({
  enabled: appConfig.oss?.enabled ?? false,
  accessKeyId: appConfig.oss?.accessKeyId || "",
  accessKeySecret: appConfig.oss?.accessKeySecret || "",
  region: appConfig.oss?.region || "cn-hangzhou",
  endpoint: appConfig.oss?.endpoint,
  bucketName: appConfig.oss?.bucketName || "",
  basePath: appConfig.oss?.basePath,
  customDomain: appConfig.oss?.customDomain,
  signedUrlExpiresSec: appConfig.oss?.signedUrlExpiresSec,
});
const imageProvider = appConfig.imageProvider === "fintopia" && appConfig.fintopia
  ? new FintopiaImageProvider(appConfig.fintopia)
  : new MockImageProvider();
const taskService = new TaskService(store, imageProvider);
const conversationService = new ConversationService(conversationStore, configStore, store, appConfig.fintopia);

function logInfo(scope: string, message: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    level: "info",
    scope,
    message,
    time: new Date().toISOString(),
    ...details,
  }));
}

function logError(scope: string, message: string, details: Record<string, unknown> = {}): void {
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

function stripModelSecret<T extends { apiKey?: string }>(model: T): Omit<T, "apiKey"> {
  const { apiKey: _apiKey, ...safeModel } = model;

  return safeModel;
}

function stripPublicModel<T extends {
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

async function readJsonRequest(req: http.IncomingMessage): Promise<unknown> {
  const body = await readRequestBody(req);

  if (!body.length) {
    return {};
  }

  return JSON.parse(body.toString("utf8"));
}

async function handleCreateTask(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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

async function handleAssetUpload(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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

function redirectOssAsset(pathname: string, res: http.ServerResponse): boolean {
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

function serveStatic(pathname: string, res: http.ServerResponse): void {
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

function isAuthorizedRequest(req: http.IncomingMessage): boolean {
  if (!adminAccessToken) {
    return true;
  }

  return req.headers["x-brand-style-token"] === adminAccessToken;
}

function hasAdminCredentials(req: http.IncomingMessage): boolean {
  return Boolean(adminAccessToken)
    && req.headers["x-brand-style-token"] === adminAccessToken;
}

const publicPluginGetRoutes = new Set([
  "/api/style-presets",
  "/api/config/models",
  "/api/config/style-skills",
  "/api/config/materials",
  "/api/config/color-palettes",
  "/api/config/shape-architectures",
  "/api/config/operation-scenarios",
  "/api/config/scenario-agents",
]);

function isPublicPluginRequest(method: string | undefined, pathname: string): boolean {
  if (method === "GET") {
    return publicPluginGetRoutes.has(pathname);
  }

  if (method === "POST") {
    return pathname === "/api/conversations"
      || pathname === "/api/scenario-agent/complete"
      || /^\/api\/conversations\/conv_[0-9a-f-]{36}\/messages$/i.test(pathname);
  }

  return method === "DELETE"
    && /^\/api\/conversations\/conv_[0-9a-f-]{36}$/i.test(pathname);
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

function consumePluginRateLimit(req: http.IncomingMessage): number {
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

const server = http.createServer(async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const startedAt = Date.now();
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const pathname = url.pathname;
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    logInfo("http", "request completed", {
      requestId,
      method: req.method,
      pathname,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  logInfo("http", "request received", {
    requestId,
    method: req.method,
    pathname,
    contentType: req.headers["content-type"] || "",
    userAgent: req.headers["user-agent"] || "",
  });

  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        name: "3D Icon Style Engine",
        provider: appConfig.imageProvider,
        model: appConfig.imageProvider === "fintopia" ? appConfig.fintopia?.model : undefined,
        storage: {
          supabase: Boolean(remoteConfigStore?.enabled),
          oss: assetStorage.enabled,
        },
      });
      return;
    }

    if (req.method === "GET" && redirectOssAsset(pathname, res)) {
      return;
    }

    const isPublicPluginApi = isPublicPluginRequest(req.method, pathname);

    if (pathname.startsWith("/api/") && !isPublicPluginApi && !isAuthorizedRequest(req)) {
      sendJson(res, 401, { error: "Unauthorized." });
      return;
    }

    if (isPublicPluginApi && req.method !== "GET") {
      const retryAfterSeconds = consumePluginRateLimit(req);

      if (retryAfterSeconds) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        sendJson(res, 429, {
          error: `请求过于频繁，请在 ${retryAfterSeconds} 秒后重试。`,
        });
        return;
      }
    }

    if (req.method === "POST" && pathname === "/api/assets") {
      await handleAssetUpload(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/style-presets") {
      sendJson(res, 200, { stylePresets });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/models") {
      const models = hasAdminCredentials(req)
        ? configStore.listModels().map(stripModelSecret)
        : configStore.listModels().map(stripPublicModel);
      sendJson(res, 200, { models });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/models") {
      const model = configStore.upsertModel(await readJsonRequest(req) as Parameters<ConfigStore["upsertModel"]>[0]);
      sendJson(res, 200, { model });
      return;
    }

    const deleteModelMatch = pathname.match(/^\/api\/config\/models\/([^/]+)$/);

    if (req.method === "DELETE" && deleteModelMatch) {
      const deleted = configStore.deleteModel(deleteModelMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/agents") {
      sendJson(res, 200, { agents: configStore.listAgents() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/style-skills") {
      sendJson(res, 200, { styleSkills: configStore.listStyleSkills() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/materials") {
      sendJson(res, 200, { materials: configStore.listMaterials() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/color-palettes") {
      sendJson(res, 200, { colorPalettes: configStore.listColorPalettes() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/shape-architectures") {
      sendJson(res, 200, { shapeArchitectures: configStore.listShapeArchitectures() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/operation-scenarios") {
      sendJson(res, 200, { operationScenarios: configStore.listOperationScenarios() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/scenario-agents") {
      sendJson(res, 200, { scenarioAgents: configStore.listScenarioAgents() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/scenario-agent-cases") {
      sendJson(res, 200, { scenarioAgentCases: configStore.listScenarioAgentCases() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/agents") {
      const agent = configStore.upsertAgent(await readJsonRequest(req) as Parameters<ConfigStore["upsertAgent"]>[0]);
      sendJson(res, 200, { agent });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/style-skills") {
      const styleSkill = configStore.upsertStyleSkill(await readJsonRequest(req) as Parameters<ConfigStore["upsertStyleSkill"]>[0]);
      sendJson(res, 200, { styleSkill });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/materials") {
      const material = configStore.upsertMaterial(await readJsonRequest(req) as Parameters<ConfigStore["upsertMaterial"]>[0]);
      sendJson(res, 200, { material });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/color-palettes") {
      const colorPalette = configStore.upsertColorPalette(await readJsonRequest(req) as Parameters<ConfigStore["upsertColorPalette"]>[0]);
      sendJson(res, 200, { colorPalette });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/shape-architectures") {
      const shapeArchitecture = configStore.upsertShapeArchitecture(await readJsonRequest(req) as Parameters<ConfigStore["upsertShapeArchitecture"]>[0]);
      sendJson(res, 200, { shapeArchitecture });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/operation-scenarios") {
      const operationScenario = configStore.upsertOperationScenario(await readJsonRequest(req) as Parameters<ConfigStore["upsertOperationScenario"]>[0]);
      sendJson(res, 200, { operationScenario });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/scenario-agents") {
      const scenarioAgent = configStore.upsertScenarioAgent(await readJsonRequest(req) as Parameters<ConfigStore["upsertScenarioAgent"]>[0]);
      sendJson(res, 200, { scenarioAgent });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/scenario-agent-cases") {
      const scenarioAgentCase = configStore.upsertScenarioAgentCase(await readJsonRequest(req) as Parameters<ConfigStore["upsertScenarioAgentCase"]>[0]);
      sendJson(res, 200, { scenarioAgentCase });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/agents/import-md") {
      const body = await readJsonRequest(req) as { markdown?: string; driverModelId?: string };
      const driverModel = configStore.listModels().find((model) => model.id === body.driverModelId);
      const draft = importAgentFromMarkdown(body.markdown || "", driverModel);
      sendJson(res, 200, { draft });
      return;
    }

    if (req.method === "POST" && pathname === "/api/config/style-skills/import-md") {
      const body = await readJsonRequest(req) as { markdown?: string; driverModelId?: string };
      const driverModel = configStore.listModels().find((model) => model.id === body.driverModelId);
      const draft = importAgentFromMarkdown(body.markdown || "", driverModel);
      sendJson(res, 200, { draft });
      return;
    }

    if (req.method === "POST" && pathname === "/api/debug-prompt") {
      const preview = await conversationService.previewPrompt(
        await readJsonRequest(req) as Parameters<ConversationService["previewPrompt"]>[0],
      );
      sendJson(res, 200, preview);
      return;
    }

    if (req.method === "POST" && pathname === "/api/scenario-agent/complete") {
      const completion = await conversationService.completeScenarioAgent(
        await readJsonRequest(req) as Parameters<ConversationService["completeScenarioAgent"]>[0],
      );
      sendJson(res, 200, completion);
      return;
    }

    const deleteAgentMatch = pathname.match(/^\/api\/config\/agents\/([^/]+)$/);

    if (req.method === "DELETE" && deleteAgentMatch) {
      const deleted = configStore.deleteAgent(deleteAgentMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    const deleteStyleSkillMatch = pathname.match(/^\/api\/config\/style-skills\/([^/]+)$/);

    if (req.method === "DELETE" && deleteStyleSkillMatch) {
      const deleted = configStore.deleteStyleSkill(deleteStyleSkillMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    const deleteMaterialMatch = pathname.match(/^\/api\/config\/materials\/([^/]+)$/);

    if (req.method === "DELETE" && deleteMaterialMatch) {
      const deleted = configStore.deleteMaterial(deleteMaterialMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    const deleteColorPaletteMatch = pathname.match(/^\/api\/config\/color-palettes\/([^/]+)$/);

    if (req.method === "DELETE" && deleteColorPaletteMatch) {
      const deleted = configStore.deleteColorPalette(deleteColorPaletteMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    const deleteShapeArchitectureMatch = pathname.match(/^\/api\/config\/shape-architectures\/([^/]+)$/);

    if (req.method === "DELETE" && deleteShapeArchitectureMatch) {
      const deleted = configStore.deleteShapeArchitecture(deleteShapeArchitectureMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    const deleteScenarioAgentMatch = pathname.match(/^\/api\/config\/scenario-agents\/([^/]+)$/);

    if (req.method === "DELETE" && deleteScenarioAgentMatch) {
      const deleted = configStore.deleteScenarioAgent(deleteScenarioAgentMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    const deleteScenarioAgentCaseMatch = pathname.match(/^\/api\/config\/scenario-agent-cases\/([^/]+)$/);

    if (req.method === "DELETE" && deleteScenarioAgentCaseMatch) {
      const deleted = configStore.deleteScenarioAgentCase(deleteScenarioAgentCaseMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    const deleteOperationScenarioMatch = pathname.match(/^\/api\/config\/operation-scenarios\/([^/]+)$/);

    if (req.method === "DELETE" && deleteOperationScenarioMatch) {
      const deleted = configStore.deleteOperationScenario(deleteOperationScenarioMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    if (req.method === "GET" && pathname === "/api/conversations") {
      sendJson(res, 200, { conversations: conversationService.list() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/conversations") {
      const conversation = conversationService.create(await readJsonRequest(req) as Parameters<ConversationService["create"]>[0]);
      sendJson(res, 201, { conversation });
      return;
    }

    const conversationMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);

    if (req.method === "DELETE" && conversationMatch) {
      const deleted = conversationStore.delete(conversationMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    if (req.method === "GET" && conversationMatch) {
      const conversation = conversationService.get(conversationMatch[1]);

      if (!conversation) {
        sendJson(res, 404, { error: "Conversation not found." });
        return;
      }

      sendJson(res, 200, { conversation });
      return;
    }

    const conversationMessageMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);

    if (req.method === "POST" && conversationMessageMatch) {
      let response: Awaited<ReturnType<ConversationService["addMessage"]>>;

      try {
        response = await conversationService.addMessage(
          conversationMessageMatch[1],
          await readJsonRequest(req) as Parameters<ConversationService["addMessage"]>[1],
        );
      } catch (error) {
        if (error instanceof Error && error.message === "Conversation not found.") {
          sendJson(res, 404, { error: error.message });
          return;
        }

        throw error;
      }

      sendJson(res, 201, response);
      return;
    }

    if (req.method === "POST" && pathname === "/api/tasks") {
      await handleCreateTask(req, res);
      return;
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);

    if (req.method === "GET" && taskMatch) {
      const task = taskService.getTask(taskMatch[1]);

      if (!task) {
        sendJson(res, 404, { error: "Task not found." });
        return;
      }

      sendJson(res, 200, { task });
      return;
    }

    const selectMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/results\/([^/]+)\/select$/);

    if (req.method === "POST" && selectMatch) {
      const task = taskService.selectResult(selectMatch[1], selectMatch[2]);

      if (!task) {
        sendJson(res, 404, { error: "Task or result not found." });
        return;
      }

      sendJson(res, 200, { task });
      return;
    }

    if (req.method === "GET") {
      serveStatic(pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    logError("http", "request failed", {
      requestId,
      method: req.method,
      pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  }
});

server.listen(port, () => {
  console.log(`3D Icon Style Engine listening on http://localhost:${port}`);
});
