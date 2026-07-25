import { boolValue, closeModals, qs, requestJson, state, uploadAsset } from "./core.js";
import { loadConfig } from "./config.js";

export function resetScenarioForm() {
  qs("#scenario-modal-title").textContent = "新建运营场景";
  qs("#scenario-form").reset();
  qs("#scenario-id").value = "";
  qs("#scenario-enabled").value = "true";
}

export function fillScenarioForm(scenario) {
  qs("#scenario-modal-title").textContent = "编辑运营场景";
  qs("#scenario-id").value = scenario.id;
  qs("#scenario-name").value = scenario.name;
  qs("#scenario-description").value = scenario.description;
  qs("#scenario-fixed-prompt").value = scenario.fixedPrompt || scenario.content || "";
  qs("#scenario-variable-prompt").value = scenario.variablePrompt || "";
  qs("#scenario-enabled").value = String(scenario.enabled);
}

export async function saveScenario(event) {
  event.preventDefault();
  await requestJson("/api/config/operation-scenarios", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: qs("#scenario-id").value || undefined,
      name: qs("#scenario-name").value,
      description: qs("#scenario-description").value,
      fixedPrompt: qs("#scenario-fixed-prompt").value,
      variablePrompt: qs("#scenario-variable-prompt").value,
      enabled: boolValue(qs("#scenario-enabled").value),
    }),
  });
  closeModals();
  await loadConfig();
}

export async function deleteScenario(scenarioId) {
  const scenario = state.operationScenarios.find((item) => item.id === scenarioId);

  if (!scenario || !confirm(`确认删除运营场景「${scenario.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/operation-scenarios/${scenarioId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

export function resetScenarioAgentForm() {
  qs("#scenario-agent-modal-title").textContent = "新建场景 Skill";
  qs("#scenario-agent-form").reset();
  qs("#scenario-agent-id").value = "";
  qs("#scenario-agent-trigger").value = "/";
  qs("#scenario-agent-output-mode").value = "prompt_sections";
  qs("#scenario-agent-version").value = "v1.0";
  qs("#scenario-agent-driver-model").value = state.models.find((model) => model.purpose === "language")?.id || state.models[0]?.id || "";
  qs("#scenario-agent-enabled").value = "true";
}

export function fillScenarioAgentForm(agent) {
  qs("#scenario-agent-modal-title").textContent = "编辑场景 Skill";
  qs("#scenario-agent-id").value = agent.id;
  qs("#scenario-agent-name").value = agent.name;
  qs("#scenario-agent-trigger").value = agent.trigger;
  qs("#scenario-agent-description").value = agent.description;
  qs("#scenario-agent-output-mode").value = agent.outputMode || "prompt_sections";
  qs("#scenario-agent-driver-model").value = agent.driverModelId || state.models.find((model) => model.purpose === "language")?.id || state.models[0]?.id || "";
  qs("#scenario-agent-version").value = agent.version || "v1.0";
  qs("#scenario-agent-enabled").value = String(agent.enabled);
  qs("#scenario-agent-skill-role").value = agent.skillRole || "";
  qs("#scenario-agent-core-rules").value = (agent.coreRules || []).join("\n");
  qs("#scenario-agent-output-contract").value = agent.outputContract || "";
  qs("#scenario-agent-positive-template").value = agent.positiveTemplate || "";
  qs("#scenario-agent-forbidden-rules").value = (agent.forbiddenRules || []).join("\n");
  qs("#scenario-agent-memory-policy").value = agent.memoryPolicy || "";
  qs("#scenario-agent-case-reference-policy").value = agent.caseReferencePolicy || "";
  qs("#scenario-agent-system-prompt").value = agent.systemPrompt;
  qs("#scenario-agent-fixed-positive-prompt").value = agent.fixedPositivePrompt || "";
  qs("#scenario-agent-fixed-negative-prompt").value = agent.fixedNegativePrompt || "";
}

export async function saveScenarioAgent(event) {
  event.preventDefault();
  await requestJson("/api/config/scenario-agents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: qs("#scenario-agent-id").value || undefined,
      name: qs("#scenario-agent-name").value,
      trigger: qs("#scenario-agent-trigger").value,
      description: qs("#scenario-agent-description").value,
      systemPrompt: qs("#scenario-agent-system-prompt").value,
      skillRole: qs("#scenario-agent-skill-role").value,
      coreRules: parseTags(qs("#scenario-agent-core-rules").value),
      outputContract: qs("#scenario-agent-output-contract").value,
      positiveTemplate: qs("#scenario-agent-positive-template").value,
      forbiddenRules: parseTags(qs("#scenario-agent-forbidden-rules").value),
      memoryPolicy: qs("#scenario-agent-memory-policy").value,
      caseReferencePolicy: qs("#scenario-agent-case-reference-policy").value,
      fixedPositivePrompt: qs("#scenario-agent-fixed-positive-prompt").value,
      fixedNegativePrompt: qs("#scenario-agent-fixed-negative-prompt").value,
      outputMode: qs("#scenario-agent-output-mode").value,
      driverModelId: qs("#scenario-agent-driver-model").value || undefined,
      version: qs("#scenario-agent-version").value || "v1.0",
      enabled: boolValue(qs("#scenario-agent-enabled").value),
    }),
  });
  closeModals();
  await loadConfig();
}

export async function deleteScenarioAgent(agentId) {
  const agent = state.scenarioAgents.find((item) => item.id === agentId);

  if (!agent || !confirm(`确认删除场景 Skill「${agent.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/scenario-agents/${agentId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

function parseTags(value) {
  return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
}

export function resetScenarioAgentCaseForm() {
  qs("#scenario-agent-case-modal-title").textContent = "新建 Skill 案例";
  qs("#scenario-agent-case-form").reset();
  qs("#scenario-agent-case-id").value = "";
  qs("#scenario-agent-case-agent").value = state.scenarioAgents[0]?.id || "";
  qs("#scenario-agent-case-rating").value = "excellent";
  qs("#scenario-agent-case-enabled").value = "true";
  qs("#scenario-agent-case-image-file").value = "";
}

export function fillScenarioAgentCaseForm(item) {
  qs("#scenario-agent-case-modal-title").textContent = "编辑 Skill 案例";
  qs("#scenario-agent-case-id").value = item.id;
  qs("#scenario-agent-case-title").value = item.title;
  qs("#scenario-agent-case-agent").value = item.scenarioAgentId;
  qs("#scenario-agent-case-rating").value = item.rating || "excellent";
  qs("#scenario-agent-case-enabled").value = String(item.enabled);
  qs("#scenario-agent-case-user-input").value = item.userInput;
  qs("#scenario-agent-case-positive-prompt").value = item.positivePrompt;
  qs("#scenario-agent-case-negative-prompt").value = item.negativePrompt || "";
  qs("#scenario-agent-case-image-url").value = item.imageUrl || item.thumbnailUrl || "";
  qs("#scenario-agent-case-image-file").value = "";
  qs("#scenario-agent-case-tags").value = (item.tags || []).join("\n");
  qs("#scenario-agent-case-notes").value = item.notes || "";
}

export async function saveScenarioAgentCase(event) {
  event.preventDefault();
  const uploadFile = qs("#scenario-agent-case-image-file").files[0];
  const uploadedUrl = uploadFile ? await uploadAsset(uploadFile, "scenario-agent-cases") : "";
  const imageUrl = uploadedUrl || qs("#scenario-agent-case-image-url").value.trim();
  await requestJson("/api/config/scenario-agent-cases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: qs("#scenario-agent-case-id").value || undefined,
      scenarioAgentId: qs("#scenario-agent-case-agent").value,
      title: qs("#scenario-agent-case-title").value,
      userInput: qs("#scenario-agent-case-user-input").value,
      positivePrompt: qs("#scenario-agent-case-positive-prompt").value,
      negativePrompt: qs("#scenario-agent-case-negative-prompt").value,
      imageUrl,
      thumbnailUrl: imageUrl,
      tags: parseTags(qs("#scenario-agent-case-tags").value),
      rating: qs("#scenario-agent-case-rating").value,
      notes: qs("#scenario-agent-case-notes").value,
      enabled: boolValue(qs("#scenario-agent-case-enabled").value),
    }),
  });
  closeModals();
  await loadConfig();
}

export async function deleteScenarioAgentCase(caseId) {
  const item = state.scenarioAgentCases.find((caseItem) => caseItem.id === caseId);

  if (!item || !confirm(`确认删除案例「${item.title}」？`)) {
    return;
  }

  await requestJson(`/api/config/scenario-agent-cases/${caseId}`, {
    method: "DELETE",
  });
  await loadConfig();
}
