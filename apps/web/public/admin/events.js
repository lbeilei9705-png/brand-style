import { escapeHtml, openModal, closeModals, qs, state } from "./core.js";
import { createMemberInvite, deleteAgent, deleteModel, fillAgentForm, fillModelForm, importAgentFromMarkdown, loadConfig, loadMemberAccess, resetAgentForm, resetModelForm, revokeMember, revokeMemberInvite, saveAgent, saveModel } from "./config.js";
import { addPaletteColorRow, deleteMaterial, deletePalette, deleteShapeArchitecture, fillMaterialForm, fillPaletteForm, fillShapeArchitectureForm, resetMaterialForm, resetPaletteForm, resetShapeArchitectureForm, saveMaterial, savePalette, saveShapeArchitecture } from "./resources-basic.js";
import { deleteScenario, deleteScenarioAgent, deleteScenarioAgentCase, fillScenarioAgentCaseForm, fillScenarioAgentForm, fillScenarioForm, resetScenarioAgentCaseForm, resetScenarioAgentForm, resetScenarioForm, saveScenario, saveScenarioAgent, saveScenarioAgentCase } from "./resources-scenarios.js";
import { bindTelemetryEvents, handleTelemetryClick } from "./telemetry-events.js";

document.addEventListener("click", async (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  handleTelemetryClick(target);
  const pageId = target.dataset.page;

  if (pageId) {
    for (const button of document.querySelectorAll(".nav-button")) {
      button.classList.toggle("active", button === target);
    }

    for (const page of document.querySelectorAll(".resource-page")) {
      page.classList.toggle("active", page.id === pageId);
    }
  }

  if (target.id === "new-model-button") {
    resetModelForm();
    openModal("model-modal");
  }

  if (target.id === "new-agent-button") {
    resetAgentForm();
    openModal("agent-modal");
  }

  if (target.id === "new-material-button") {
    resetMaterialForm();
    openModal("material-modal");
  }

  if (target.id === "new-palette-button") {
    resetPaletteForm();
    openModal("palette-modal");
  }

  if (target.id === "new-shape-architecture-button") {
    resetShapeArchitectureForm();
    openModal("shape-architecture-modal");
  }

  if (target.id === "new-scenario-button") {
    resetScenarioForm();
    openModal("scenario-modal");
  }

  if (target.id === "new-scenario-agent-button") {
    resetScenarioAgentForm();
    openModal("scenario-agent-modal");
  }

  if (target.id === "new-scenario-agent-case-button") {
    resetScenarioAgentCaseForm();
    openModal("scenario-agent-case-modal");
  }

  if (target.id === "import-agent-button") {
    qs("#agent-md-file").click();
  }

  if (target.dataset.closeModal !== undefined) {
    closeModals();
  }

  if (target.dataset.action === "edit-model") {
    const model = state.models.find((item) => item.id === target.dataset.id);
    if (model) {
      fillModelForm(model);
      openModal("model-modal");
    }
  }

  if (target.dataset.action === "delete-model") {
    await deleteModel(target.dataset.id);
  }

  if (target.dataset.action === "edit-agent") {
    const agent = state.agents.find((item) => item.id === target.dataset.id);
    if (agent) {
      fillAgentForm(agent);
      openModal("agent-modal");
    }
  }

  if (target.dataset.action === "delete-agent") {
    await deleteAgent(target.dataset.id);
  }

  if (target.dataset.action === "edit-material") {
    const material = state.materials.find((item) => item.id === target.dataset.id);
    if (material) {
      fillMaterialForm(material);
      openModal("material-modal");
    }
  }

  if (target.dataset.action === "delete-material") {
    await deleteMaterial(target.dataset.id);
  }

  if (target.dataset.action === "edit-palette") {
    const palette = state.colorPalettes.find((item) => item.id === target.dataset.id);
    if (palette) {
      fillPaletteForm(palette);
      openModal("palette-modal");
    }
  }

  if (target.dataset.action === "delete-palette") {
    await deletePalette(target.dataset.id);
  }

  if (target.dataset.action === "edit-shape-architecture") {
    const architecture = state.shapeArchitectures.find((item) => item.id === target.dataset.id);
    if (architecture) {
      fillShapeArchitectureForm(architecture);
      openModal("shape-architecture-modal");
    }
  }

  if (target.dataset.action === "delete-shape-architecture") {
    await deleteShapeArchitecture(target.dataset.id);
  }

  if (target.dataset.action === "edit-scenario") {
    const scenario = state.operationScenarios.find((item) => item.id === target.dataset.id);
    if (scenario) {
      fillScenarioForm(scenario);
      openModal("scenario-modal");
    }
  }

  if (target.dataset.action === "delete-scenario") {
    await deleteScenario(target.dataset.id);
  }

  if (target.dataset.action === "edit-scenario-agent") {
    const agent = state.scenarioAgents.find((item) => item.id === target.dataset.id);
    if (agent) {
      fillScenarioAgentForm(agent);
      openModal("scenario-agent-modal");
    }
  }

  if (target.dataset.action === "delete-scenario-agent") {
    await deleteScenarioAgent(target.dataset.id);
  }

  if (target.dataset.action === "edit-scenario-agent-case") {
    const item = state.scenarioAgentCases.find((caseItem) => caseItem.id === target.dataset.id);
    if (item) {
      fillScenarioAgentCaseForm(item);
      openModal("scenario-agent-case-modal");
    }
  }

  if (target.dataset.action === "delete-scenario-agent-case") {
    await deleteScenarioAgentCase(target.dataset.id);
  }

  if (target.dataset.action === "revoke-member") {
    await revokeMember(target.dataset.id);
  }

  if (target.dataset.action === "revoke-member-invite") {
    await revokeMemberInvite(target.dataset.id);
  }

  if (target.id === "copy-generated-invite") {
    await navigator.clipboard.writeText(qs("#generated-invite-code").textContent);
    target.textContent = "已复制";
    window.setTimeout(() => {
      target.textContent = "复制邀请码";
    }, 1200);
  }
});

qs("#model-form").addEventListener("submit", saveModel);
qs("#agent-form").addEventListener("submit", saveAgent);
qs("#material-form").addEventListener("submit", saveMaterial);
qs("#palette-form").addEventListener("submit", savePalette);
qs("#add-palette-color-button").addEventListener("click", () => addPaletteColorRow());
qs("#shape-architecture-form").addEventListener("submit", saveShapeArchitecture);
qs("#scenario-form").addEventListener("submit", saveScenario);
qs("#scenario-agent-form").addEventListener("submit", saveScenarioAgent);
qs("#scenario-agent-case-form").addEventListener("submit", saveScenarioAgentCase);
qs("#member-invite-form").addEventListener("submit", createMemberInvite);
qs("#agent-md-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (file) {
    await importAgentFromMarkdown(file);
    event.target.value = "";
  }
});
bindTelemetryEvents();

loadConfig().catch((error) => {
  qs("#models-table").innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
});
loadMemberAccess().catch((error) => {
  qs("#member-access-members-table").innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
});
