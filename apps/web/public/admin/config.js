import { boolValue, closeModals, openModal, qs, requestJson, state } from "./core.js";
import { renderAgentDriverOptions, renderAgents, renderMaterials, renderMemberAccess, renderModels, renderPalettes, renderScenarioAgentCases, renderScenarioAgents, renderScenarios, renderShapeArchitectures } from "./render.js";

export async function loadMemberAccess() {
  const data = await requestJson("/api/admin/member-access");
  state.memberInvites = data.invites || [];
  state.members = data.members || [];
  renderMemberAccess();
}

export async function createMemberInvite(event) {
  event.preventDefault();
  const data = await requestJson("/api/admin/member-invites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      memberName: qs("#member-invite-name").value.trim(),
      dailyLimit: Number(qs("#member-invite-daily-limit").value),
      expiresInHours: Number(qs("#member-invite-expiry").value),
    }),
  });
  qs("#generated-invite-code").textContent = data.code;
  qs("#generated-invite").hidden = false;
  qs("#member-invite-name").value = "";
  await loadMemberAccess();
}

export async function revokeMember(memberId) {
  const member = state.members.find((item) => item.id === memberId);

  if (!member || !confirm(`确认撤销「${member.name}」的全部访问权限？`)) {
    return;
  }

  await requestJson(`/api/admin/members/${memberId}`, {
    method: "DELETE",
  });
  await loadMemberAccess();
}

export async function revokeMemberInvite(inviteId) {
  const invite = state.memberInvites.find((item) => item.id === inviteId);

  if (!invite || !confirm(`确认作废为「${invite.memberName}」创建的邀请码？`)) {
    return;
  }

  await requestJson(`/api/admin/member-invites/${inviteId}`, {
    method: "DELETE",
  });
  await loadMemberAccess();
}

export async function loadConfig() {
  const [modelsData, agentsData, materialsData, palettesData, shapeArchitecturesData, scenariosData, scenarioAgentsData, scenarioAgentCasesData] = await Promise.all([
    requestJson("/api/config/models"),
    requestJson("/api/config/style-skills"),
    requestJson("/api/config/materials"),
    requestJson("/api/config/color-palettes"),
    requestJson("/api/config/shape-architectures"),
    requestJson("/api/config/operation-scenarios"),
    requestJson("/api/config/scenario-agents"),
    requestJson("/api/config/scenario-agent-cases"),
  ]);
  state.models = modelsData.models;
  state.agents = agentsData.styleSkills || agentsData.agents || [];
  state.materials = materialsData.materials || [];
  state.colorPalettes = palettesData.colorPalettes || [];
  state.shapeArchitectures = shapeArchitecturesData.shapeArchitectures || [];
  state.operationScenarios = scenariosData.operationScenarios || [];
  state.scenarioAgents = scenarioAgentsData.scenarioAgents || [];
  state.scenarioAgentCases = scenarioAgentCasesData.scenarioAgentCases || [];
  renderModels();
  renderAgentDriverOptions();
  renderAgents();
  renderMaterials();
  renderPalettes();
  renderShapeArchitectures();
  renderScenarios();
  renderScenarioAgents();
  renderScenarioAgentCases();
}

export function resetModelForm() {
  qs("#model-modal-title").textContent = "新建模型";
  qs("#model-form").reset();
  qs("#model-id").value = "";
  qs("#model-provider").value = "mock";
  qs("#model-quality").value = "auto";
  qs("#model-api-style").value = "azure";
  qs("#model-purpose").value = "image";
  qs("#model-enabled").value = "true";
}

export function fillModelForm(model) {
  qs("#model-modal-title").textContent = "编辑模型";
  qs("#model-id").value = model.id;
  qs("#model-name").value = model.name;
  qs("#model-provider").value = model.provider;
  qs("#model-value").value = model.model;
  qs("#model-api-url").value = model.apiUrl || "";
  qs("#model-api-version").value = model.apiVersion || "";
  qs("#model-api-style").value = model.apiStyle || "azure";
  qs("#model-api-path").value = model.apiPath || "";
  qs("#model-api-key").value = model.apiKey || "";
  qs("#model-quality").value = model.quality;
  qs("#model-purpose").value = model.purpose || "image";
  qs("#model-enabled").value = String(model.enabled);
}

export async function saveModel(event) {
  event.preventDefault();
  await requestJson("/api/config/models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: qs("#model-id").value || undefined,
      name: qs("#model-name").value,
      provider: qs("#model-provider").value,
      model: qs("#model-value").value,
      apiUrl: qs("#model-api-url").value || undefined,
      apiVersion: qs("#model-api-version").value || "",
      apiStyle: qs("#model-api-style").value,
      apiPath: qs("#model-api-path").value || undefined,
      apiKey: qs("#model-api-key").value || undefined,
      purpose: qs("#model-purpose").value,
      quality: qs("#model-quality").value,
      enabled: boolValue(qs("#model-enabled").value),
    }),
  });
  closeModals();
  await loadConfig();
}

export async function deleteModel(modelId) {
  const model = state.models.find((item) => item.id === modelId);

  if (!model || !confirm(`确认删除模型「${model.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/models/${modelId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

export function resetAgentForm() {
  qs("#agent-modal-title").textContent = "新建品牌预设";
  qs("#agent-form").reset();
  qs("#agent-id").value = "";
  qs("#agent-style-preset").value = "";
  qs("#agent-driver-model").value = state.models[0]?.id || "";
  qs("#agent-enabled").value = "true";
}

export function fillAgentForm(agent) {
  qs("#agent-modal-title").textContent = "编辑品牌预设";
  qs("#agent-id").value = agent.id;
  qs("#agent-name").value = agent.name;
  qs("#agent-description").value = agent.description;
  qs("#agent-style-preset").value = agent.defaultStylePresetId;
  qs("#agent-driver-model").value = agent.driverModelId || state.models[0]?.id || "";
  qs("#agent-enabled").value = String(agent.enabled);
  qs("#agent-system-prompt").value = agent.systemPrompt;
  qs("#agent-negative-rules").value = agent.defaultNegativeRules.join("\n");
}

export async function saveAgent(event) {
  event.preventDefault();
  await requestJson("/api/config/style-skills", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: qs("#agent-id").value || undefined,
      name: qs("#agent-name").value,
      description: qs("#agent-description").value,
      systemPrompt: qs("#agent-system-prompt").value,
      defaultStylePresetId: qs("#agent-style-preset").value,
      defaultNegativeRules: qs("#agent-negative-rules").value.split("\n").map((item) => item.trim()).filter(Boolean),
      driverModelId: qs("#agent-driver-model").value,
      enabled: boolValue(qs("#agent-enabled").value),
    }),
  });
  closeModals();
  await loadConfig();
}

export async function deleteAgent(agentId) {
  const agent = state.agents.find((item) => item.id === agentId);

  if (!agent || !confirm(`确认删除品牌预设「${agent.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/style-skills/${agentId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

export async function importAgentFromMarkdown(file) {
  const markdown = await file.text();
  const driverModelId = qs("#import-driver-model").value || state.models[0]?.id || "";
  const data = await requestJson("/api/config/style-skills/import-md", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      markdown,
      driverModelId,
    }),
  });

  resetAgentForm();
  fillAgentForm(data.draft);
  qs("#agent-id").value = "";
  qs("#agent-driver-model").value = data.draft.driverModelId || driverModelId;
  qs("#agent-modal-title").textContent = `导入品牌预设草稿（${data.draft.parseMode}）`;
  openModal("agent-modal");
}
