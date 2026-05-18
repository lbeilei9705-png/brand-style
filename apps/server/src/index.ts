import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { stylePresets } from "../../../packages/shared/src/index.ts";
import type { CreateTaskRequest, InputType, OutputTarget } from "../../../packages/shared/src/index.ts";
import { importAgentFromMarkdown } from "./agentMarkdownImporter.ts";
import { getAppConfig, loadDotEnv } from "./config.ts";
import { ConfigStore } from "./configStore.ts";
import { ConversationService } from "./conversationService.ts";
import { ConversationStore } from "./conversationStore.ts";
import { parseMultipart, readRequestBody } from "./http/multipart.ts";
import { send, sendJson } from "./http/response.ts";
import { FintopiaImageProvider } from "./providers/fintopiaImageProvider.ts";
import { MockImageProvider } from "./providers/mockImageProvider.ts";
import { TaskService } from "./taskService.ts";
import { TaskStore } from "./taskStore.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
loadDotEnv(projectRoot);
const appConfig = getAppConfig();
const port = Number(process.env.PORT || 5180);
const webDir = path.resolve(__dirname, "../../web/public");
const dataDir = path.resolve(projectRoot, "data");
const configStore = new ConfigStore(dataDir);
const conversationStore = new ConversationStore(dataDir);
const store = new TaskStore();
const imageProvider = appConfig.imageProvider === "fintopia" && appConfig.fintopia
  ? new FintopiaImageProvider(appConfig.fintopia)
  : new MockImageProvider();
const taskService = new TaskService(store, imageProvider);
const conversationService = new ConversationService(conversationStore, configStore, store, appConfig.fintopia);

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
      batchSize: Number(raw.batchSize || 4),
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
      batchSize: Number(parsed.fields.batchSize || 4),
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
  const response = await taskService.createTask(request);

  sendJson(res, 201, response);
}

function serveStatic(pathname: string, res: http.ServerResponse): void {
  const safePath = pathname === "/" ? "/index.html" : pathname;
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

    const ext = path.extname(filePath);
    const contentType = ext === ".css"
      ? "text/css; charset=utf-8"
      : ext === ".js"
        ? "application/javascript; charset=utf-8"
        : "text/html; charset=utf-8";

    send(res, 200, content, contentType);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const pathname = url.pathname;

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
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/style-presets") {
      sendJson(res, 200, { stylePresets });
      return;
    }

    if (req.method === "GET" && pathname === "/api/config/models") {
      sendJson(res, 200, { models: configStore.listModels() });
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
      const response = await conversationService.addMessage(
        conversationMessageMatch[1],
        await readJsonRequest(req) as Parameters<ConversationService["addMessage"]>[1],
      );
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
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  }
});

server.listen(port, () => {
  console.log(`3D Icon Style Engine listening on http://localhost:${port}`);
});
