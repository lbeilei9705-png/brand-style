import type http from "http";
import { stylePresets } from "../../../../packages/shared/src/index.ts";
import { importAgentFromMarkdown } from "../agentMarkdownImporter.ts";
import type { ConfigStore } from "../configStore.ts";
import type { ConversationService } from "../conversationService.ts";
import { sendJson } from "../http/response.ts";
import { hasAdminCredentials, readJsonRequest, stripModelSecret, stripPublicModel } from "../serverHttp.ts";

export async function handleConfigRoutes(input: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  pathname: string;
  configStore: ConfigStore;
  conversationService: ConversationService;
}): Promise<boolean> {
  const { req, res, pathname, configStore, conversationService } = input;
    if (req.method === "GET" && pathname === "/api/style-presets") {
      sendJson(res, 200, { stylePresets });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/models") {
      const models = hasAdminCredentials(req)
        ? configStore.listModels().map(stripModelSecret)
        : configStore.listModels().map(stripPublicModel);
      sendJson(res, 200, { models });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/models") {
      const model = configStore.upsertModel(await readJsonRequest(req) as Parameters<ConfigStore["upsertModel"]>[0]);
      sendJson(res, 200, { model });
      return true;
    }

    const deleteModelMatch = pathname.match(/^\/api\/config\/models\/([^/]+)$/);

    if (req.method === "DELETE" && deleteModelMatch) {
      const deleted = configStore.deleteModel(deleteModelMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/agents") {
      sendJson(res, 200, { agents: configStore.listAgents() });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/style-skills") {
      sendJson(res, 200, { styleSkills: configStore.listStyleSkills() });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/materials") {
      sendJson(res, 200, { materials: configStore.listMaterials() });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/color-palettes") {
      sendJson(res, 200, { colorPalettes: configStore.listColorPalettes() });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/shape-architectures") {
      sendJson(res, 200, { shapeArchitectures: configStore.listShapeArchitectures() });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/operation-scenarios") {
      sendJson(res, 200, { operationScenarios: configStore.listOperationScenarios() });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/scenario-agents") {
      sendJson(res, 200, { scenarioAgents: configStore.listScenarioAgents() });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/config/scenario-agent-cases") {
      sendJson(res, 200, { scenarioAgentCases: configStore.listScenarioAgentCases() });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/agents") {
      const agent = configStore.upsertAgent(await readJsonRequest(req) as Parameters<ConfigStore["upsertAgent"]>[0]);
      sendJson(res, 200, { agent });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/style-skills") {
      const styleSkill = configStore.upsertStyleSkill(await readJsonRequest(req) as Parameters<ConfigStore["upsertStyleSkill"]>[0]);
      sendJson(res, 200, { styleSkill });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/materials") {
      const material = configStore.upsertMaterial(await readJsonRequest(req) as Parameters<ConfigStore["upsertMaterial"]>[0]);
      sendJson(res, 200, { material });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/color-palettes") {
      const colorPalette = configStore.upsertColorPalette(await readJsonRequest(req) as Parameters<ConfigStore["upsertColorPalette"]>[0]);
      sendJson(res, 200, { colorPalette });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/shape-architectures") {
      const shapeArchitecture = configStore.upsertShapeArchitecture(await readJsonRequest(req) as Parameters<ConfigStore["upsertShapeArchitecture"]>[0]);
      sendJson(res, 200, { shapeArchitecture });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/operation-scenarios") {
      const operationScenario = configStore.upsertOperationScenario(await readJsonRequest(req) as Parameters<ConfigStore["upsertOperationScenario"]>[0]);
      sendJson(res, 200, { operationScenario });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/scenario-agents") {
      const scenarioAgent = configStore.upsertScenarioAgent(await readJsonRequest(req) as Parameters<ConfigStore["upsertScenarioAgent"]>[0]);
      sendJson(res, 200, { scenarioAgent });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/scenario-agent-cases") {
      const scenarioAgentCase = configStore.upsertScenarioAgentCase(await readJsonRequest(req) as Parameters<ConfigStore["upsertScenarioAgentCase"]>[0]);
      sendJson(res, 200, { scenarioAgentCase });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/agents/import-md") {
      const body = await readJsonRequest(req) as { markdown?: string; driverModelId?: string };
      const driverModel = configStore.listModels().find((model) => model.id === body.driverModelId);
      const draft = importAgentFromMarkdown(body.markdown || "", driverModel);
      sendJson(res, 200, { draft });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/config/style-skills/import-md") {
      const body = await readJsonRequest(req) as { markdown?: string; driverModelId?: string };
      const driverModel = configStore.listModels().find((model) => model.id === body.driverModelId);
      const draft = importAgentFromMarkdown(body.markdown || "", driverModel);
      sendJson(res, 200, { draft });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/debug-prompt") {
      const preview = await conversationService.previewPrompt(
        await readJsonRequest(req) as Parameters<ConversationService["previewPrompt"]>[0],
      );
      sendJson(res, 200, preview);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/scenario-agent/complete") {
      const completion = await conversationService.completeScenarioAgent(
        await readJsonRequest(req) as Parameters<ConversationService["completeScenarioAgent"]>[0],
      );
      sendJson(res, 200, completion);
      return true;
    }

    const deleteAgentMatch = pathname.match(/^\/api\/config\/agents\/([^/]+)$/);

    if (req.method === "DELETE" && deleteAgentMatch) {
      const deleted = configStore.deleteAgent(deleteAgentMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

    const deleteStyleSkillMatch = pathname.match(/^\/api\/config\/style-skills\/([^/]+)$/);

    if (req.method === "DELETE" && deleteStyleSkillMatch) {
      const deleted = configStore.deleteStyleSkill(deleteStyleSkillMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

    const deleteMaterialMatch = pathname.match(/^\/api\/config\/materials\/([^/]+)$/);

    if (req.method === "DELETE" && deleteMaterialMatch) {
      const deleted = configStore.deleteMaterial(deleteMaterialMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

    const deleteColorPaletteMatch = pathname.match(/^\/api\/config\/color-palettes\/([^/]+)$/);

    if (req.method === "DELETE" && deleteColorPaletteMatch) {
      const deleted = configStore.deleteColorPalette(deleteColorPaletteMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

    const deleteShapeArchitectureMatch = pathname.match(/^\/api\/config\/shape-architectures\/([^/]+)$/);

    if (req.method === "DELETE" && deleteShapeArchitectureMatch) {
      const deleted = configStore.deleteShapeArchitecture(deleteShapeArchitectureMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

    const deleteScenarioAgentMatch = pathname.match(/^\/api\/config\/scenario-agents\/([^/]+)$/);

    if (req.method === "DELETE" && deleteScenarioAgentMatch) {
      const deleted = configStore.deleteScenarioAgent(deleteScenarioAgentMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

    const deleteScenarioAgentCaseMatch = pathname.match(/^\/api\/config\/scenario-agent-cases\/([^/]+)$/);

    if (req.method === "DELETE" && deleteScenarioAgentCaseMatch) {
      const deleted = configStore.deleteScenarioAgentCase(deleteScenarioAgentCaseMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

    const deleteOperationScenarioMatch = pathname.match(/^\/api\/config\/operation-scenarios\/([^/]+)$/);

    if (req.method === "DELETE" && deleteOperationScenarioMatch) {
      const deleted = configStore.deleteOperationScenario(deleteOperationScenarioMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return true;
    }

  return false;
}
