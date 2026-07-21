const state = {
  models: [],
  agents: [],
  materials: [],
  colorPalettes: [],
  shapeArchitectures: [],
  operationScenarios: [],
  scenarioAgents: [],
  scenarioAgentCases: [],
};

const accessTokenStorageKey = "brand-style-admin-token";

function qs(selector) {
  return document.querySelector(selector);
}

function getAccessToken() {
  const savedToken = localStorage.getItem(accessTokenStorageKey);

  if (savedToken) {
    return savedToken;
  }

  const token = prompt("请输入后台访问 token");

  if (token) {
    localStorage.setItem(accessTokenStorageKey, token);
  }

  return token;
}

async function requestJson(url, options = {}, hasRetried = false) {
  const accessToken = getAccessToken();

  if (!accessToken) {
    throw new Error("需要后台访问 token 才能读取配置。");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "x-brand-style-token": accessToken,
    },
  });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(accessTokenStorageKey);

      if (!hasRetried) {
        return requestJson(url, options, true);
      }
    }

    throw new Error(data.error || "请求失败");
  }

  return data;
}

async function uploadAsset(file, category) {
  const formData = new FormData();
  formData.append("category", category);
  formData.append("asset", file);
  const data = await requestJson("/api/assets", {
    method: "POST",
    body: formData,
  });

  return data.asset?.url || "";
}

function boolValue(value) {
  return value === true || value === "true";
}

function openModal(id) {
  qs(`#${id}`).classList.add("open");
}

function closeModals() {
  for (const modal of document.querySelectorAll(".modal-backdrop")) {
    modal.classList.remove("open");
  }
}

function renderStatus(enabled) {
  return `<span class="pill${enabled ? "" : " off"}">${enabled ? "已启用" : "已停用"}</span>`;
}

function renderModels() {
  const table = qs("#models-table");
  table.innerHTML = "";

  for (const model of state.models) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${model.name}</strong>
        <span class="muted">${model.model}</span>
      </td>
      <td>${model.provider} / ${model.purpose === "language" ? "语言" : "生图"}</td>
      <td>${model.apiStyle || "azure"} / ${model.apiVersion || "无版本"} / ${model.quality}</td>
      <td>${renderStatus(model.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-model" data-id="${model.id}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-model" data-id="${model.id}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

function renderAgentDriverOptions() {
  const select = qs("#agent-driver-model");
  const importSelect = qs("#import-driver-model");
  const scenarioAgentSelect = qs("#scenario-agent-driver-model");
  const scenarioAgentCaseSelect = qs("#scenario-agent-case-agent");
  select.innerHTML = "";
  importSelect.innerHTML = "";
  scenarioAgentSelect.innerHTML = "";
  scenarioAgentCaseSelect.innerHTML = "";

  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    select.appendChild(option);
    importSelect.appendChild(option.cloneNode(true));
    scenarioAgentSelect.appendChild(option.cloneNode(true));
  }

  for (const agent of state.scenarioAgents) {
    const option = document.createElement("option");
    option.value = agent.id;
    option.textContent = `${agent.name}（${agent.trigger}）`;
    scenarioAgentCaseSelect.appendChild(option);
  }
}

function renderAgents() {
  const table = qs("#agents-table");
  table.innerHTML = "";

  for (const agent of state.agents) {
    const driver = state.models.find((model) => model.id === agent.driverModelId);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${agent.name}</strong>
        <span class="muted">${agent.description}</span>
      </td>
      <td>${driver?.name || agent.driverModelId || "-"}</td>
      <td>${renderStatus(agent.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-agent" data-id="${agent.id}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-agent" data-id="${agent.id}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

function renderMaterials() {
  const table = qs("#materials-table");
  table.innerHTML = "";

  for (const material of state.materials) {
    const preview = material.previewImageUrl
      ? `<img src="${material.previewImageUrl}" alt="${material.name}" loading="lazy" />`
      : `<span class="material-thumb-fallback"></span>`;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="material-cell">
          <span class="material-thumb">${preview}</span>
          <div>
            <strong>${material.name}</strong>
            <span class="muted">${material.previewImageUrl ? "已配置预览图" : "未配置预览图"}</span>
          </div>
        </div>
      </td>
      <td>${material.prompt}</td>
      <td>${renderStatus(material.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-material" data-id="${material.id}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-material" data-id="${material.id}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

function renderColorSwatches(colors) {
  return colors.map((color) => `<span title="${color}" style="display:inline-block;width:18px;height:18px;border-radius:999px;border:1px solid #d0d5dd;background:${color};"></span>`).join("");
}

function renderPalettes() {
  const table = qs("#palettes-table");
  table.innerHTML = "";

  for (const palette of state.colorPalettes) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${palette.name}</strong>
        <span class="muted">${palette.description}</span>
      </td>
      <td><div style="display:flex;gap:6px;align-items:center;">${renderColorSwatches(palette.colors)}</div><span class="muted">${palette.colors.join(" / ")}</span></td>
      <td>${palette.prompt}</td>
      <td>${renderStatus(palette.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-palette" data-id="${palette.id}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-palette" data-id="${palette.id}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

function renderShapeArchitectures() {
  const table = qs("#shape-architectures-table");
  table.innerHTML = "";

  for (const architecture of state.shapeArchitectures) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${architecture.name}</strong>
        <span class="muted">${architecture.description}</span>
      </td>
      <td>${architecture.prompt}</td>
      <td>${renderStatus(architecture.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-shape-architecture" data-id="${architecture.id}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-shape-architecture" data-id="${architecture.id}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

function renderScenarios() {
  const table = qs("#scenarios-table");
  table.innerHTML = "";

  for (const scenario of state.operationScenarios) {
    const fixedPrompt = scenario.fixedPrompt || scenario.content || "";
    const variablePrompt = scenario.variablePrompt || "";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${scenario.name}</strong>
        <span class="muted">${scenario.description}</span>
      </td>
      <td>${fixedPrompt}</td>
      <td>${variablePrompt}</td>
      <td>${renderStatus(scenario.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-scenario" data-id="${scenario.id}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-scenario" data-id="${scenario.id}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

function renderScenarioAgents() {
  const table = qs("#scenario-agents-table");
  table.innerHTML = "";

  for (const agent of state.scenarioAgents) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${agent.name}</strong>
        <span class="muted">${agent.description}</span>
      </td>
      <td><strong>${agent.trigger}</strong><span class="muted">${agent.version || "-"}</span></td>
      <td>${agent.outputMode === "json_final_prompt" ? "JSON finalPrompt" : "prompt_main / prompt_negative"}</td>
      <td>${renderStatus(agent.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-scenario-agent" data-id="${agent.id}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-scenario-agent" data-id="${agent.id}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

function renderScenarioAgentCases() {
  const container = qs("#scenario-agent-cases-groups");
  container.innerHTML = "";
  const ratingText = {
    excellent: "优秀",
    neutral: "一般",
    failed: "失败",
  };
  const groups = state.scenarioAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    trigger: agent.trigger,
    description: agent.description,
    items: state.scenarioAgentCases.filter((item) => item.scenarioAgentId === agent.id),
  }));
  const unmatchedItems = state.scenarioAgentCases.filter((item) => (
    !state.scenarioAgents.some((agent) => agent.id === item.scenarioAgentId)
  ));

  if (unmatchedItems.length) {
    groups.push({
      id: "__unmatched__",
      name: "未匹配 Skill",
      trigger: "案例所属 Skill 已删除或不可用",
      description: "这些案例仍保留在案例库中，但当前找不到对应场景 Skill 配置。",
      items: unmatchedItems,
    });
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "case-group";
    const rows = group.items.map((item) => `
      <tr>
        <td>
          <div class="material-cell">
            <span class="material-thumb">${
              item.thumbnailUrl || item.imageUrl
                ? `<img src="${item.thumbnailUrl || item.imageUrl}" alt="${item.title}" loading="lazy" />`
                : '<span class="material-thumb-fallback"></span>'
            }</span>
            <div>
              <strong>${item.title}</strong>
              <span class="muted">${item.userInput}</span>
            </div>
          </div>
        </td>
        <td>
          <strong>${ratingText[item.rating] || item.rating}</strong>
          <span class="muted">${(item.tags || []).join(" / ") || "-"}</span>
        </td>
        <td>${renderStatus(item.enabled)}</td>
        <td>
          <div class="row-actions">
            <button class="secondary-button" data-action="edit-scenario-agent-case" data-id="${item.id}" type="button">编辑</button>
            <button class="danger-button" data-action="delete-scenario-agent-case" data-id="${item.id}" type="button">删除</button>
          </div>
        </td>
      </tr>
    `).join("");

    section.innerHTML = `
      <header class="case-group-header">
        <div>
          <h3>${group.name}</h3>
          <p class="muted">${group.trigger}${group.description ? ` · ${group.description}` : ""}</p>
        </div>
        <span class="case-count">${group.items.length} 个案例</span>
      </header>
      <table>
        <thead>
          <tr>
            <th>案例</th>
            <th>标签 / 评分</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">暂无案例</td></tr>'}</tbody>
      </table>
    `;
    container.appendChild(section);
  }
}

async function loadConfig() {
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

function resetModelForm() {
  qs("#model-modal-title").textContent = "新建模型";
  qs("#model-form").reset();
  qs("#model-id").value = "";
  qs("#model-provider").value = "mock";
  qs("#model-quality").value = "auto";
  qs("#model-api-style").value = "azure";
  qs("#model-purpose").value = "image";
  qs("#model-enabled").value = "true";
}

function fillModelForm(model) {
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

async function saveModel(event) {
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

async function deleteModel(modelId) {
  const model = state.models.find((item) => item.id === modelId);

  if (!model || !confirm(`确认删除模型「${model.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/models/${modelId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

function resetAgentForm() {
  qs("#agent-modal-title").textContent = "新建风格套装";
  qs("#agent-form").reset();
  qs("#agent-id").value = "";
  qs("#agent-style-preset").value = "";
  qs("#agent-driver-model").value = state.models[0]?.id || "";
  qs("#agent-enabled").value = "true";
}

function fillAgentForm(agent) {
  qs("#agent-modal-title").textContent = "编辑风格套装";
  qs("#agent-id").value = agent.id;
  qs("#agent-name").value = agent.name;
  qs("#agent-description").value = agent.description;
  qs("#agent-style-preset").value = agent.defaultStylePresetId;
  qs("#agent-driver-model").value = agent.driverModelId || state.models[0]?.id || "";
  qs("#agent-enabled").value = String(agent.enabled);
  qs("#agent-system-prompt").value = agent.systemPrompt;
  qs("#agent-negative-rules").value = agent.defaultNegativeRules.join("\n");
}

async function saveAgent(event) {
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

async function deleteAgent(agentId) {
  const agent = state.agents.find((item) => item.id === agentId);

  if (!agent || !confirm(`确认删除风格套装「${agent.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/style-skills/${agentId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

async function importAgentFromMarkdown(file) {
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
  qs("#agent-modal-title").textContent = `导入风格套装草稿（${data.draft.parseMode}）`;
  openModal("agent-modal");
}

function resetMaterialForm() {
  qs("#material-modal-title").textContent = "新建材质";
  qs("#material-form").reset();
  qs("#material-id").value = "";
  qs("#material-enabled").value = "true";
  qs("#material-preview-image-file").value = "";
}

function fillMaterialForm(material) {
  qs("#material-modal-title").textContent = "编辑材质";
  qs("#material-id").value = material.id;
  qs("#material-name").value = material.name;
  qs("#material-prompt").value = material.prompt;
  qs("#material-preview-image-url").value = material.previewImageUrl || "";
  qs("#material-enabled").value = String(material.enabled);
}

async function saveMaterial(event) {
  event.preventDefault();
  const uploadFile = qs("#material-preview-image-file").files[0];
  const uploadedUrl = uploadFile ? await uploadAsset(uploadFile, "material-thumbnails") : "";
  await requestJson("/api/config/materials", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: qs("#material-id").value || undefined,
      name: qs("#material-name").value,
      description: qs("#material-name").value,
      prompt: qs("#material-prompt").value,
      previewImageUrl: uploadedUrl || qs("#material-preview-image-url").value.trim(),
      enabled: boolValue(qs("#material-enabled").value),
    }),
  });
  closeModals();
  await loadConfig();
}

async function deleteMaterial(materialId) {
  const material = state.materials.find((item) => item.id === materialId);

  if (!material || !confirm(`确认删除材质「${material.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/materials/${materialId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

function parseColors(value) {
  return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeHexColor(value) {
  const trimmed = String(value || "").trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const shortMatch = withHash.match(/^#([0-9a-fA-F]{3})$/);

  if (shortMatch) {
    return `#${shortMatch[1].split("").map((char) => char + char).join("")}`.toUpperCase();
  }

  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toUpperCase() : "";
}

function getPaletteEditorColors() {
  return [...document.querySelectorAll("[data-palette-color-value]")]
    .map((input) => normalizeHexColor(input.value))
    .filter(Boolean);
}

function syncPaletteColorsInput() {
  qs("#palette-colors").value = getPaletteEditorColors().join("\n");
}

function addPaletteColorRow(color = "#D9D9D9") {
  const normalized = normalizeHexColor(color) || "#D9D9D9";
  const editor = qs("#palette-color-editor");
  const row = document.createElement("div");
  row.className = "palette-color-row";
  row.innerHTML = `
    <input type="color" value="${normalized}" aria-label="选择颜色" />
    <input data-palette-color-value type="text" value="${normalized}" placeholder="#D9D9D9" />
    <button class="secondary-button palette-color-remove" type="button">删除</button>
  `;
  const colorInput = row.querySelector('input[type="color"]');
  const textInput = row.querySelector("[data-palette-color-value]");
  const removeButton = row.querySelector(".palette-color-remove");
  colorInput.addEventListener("input", () => {
    textInput.value = normalizeHexColor(colorInput.value) || colorInput.value.toUpperCase();
    syncPaletteColorsInput();
  });
  textInput.addEventListener("input", () => {
    const nextColor = normalizeHexColor(textInput.value);

    if (nextColor) {
      colorInput.value = nextColor;
    }

    syncPaletteColorsInput();
  });
  textInput.addEventListener("blur", () => {
    textInput.value = normalizeHexColor(textInput.value) || normalized;
    colorInput.value = textInput.value;
    syncPaletteColorsInput();
  });
  removeButton.addEventListener("click", () => {
    row.remove();
    syncPaletteColorsInput();
  });
  editor.appendChild(row);
  syncPaletteColorsInput();
}

function renderPaletteColorEditor(colors = []) {
  qs("#palette-color-editor").innerHTML = "";
  const safeColors = colors.map(normalizeHexColor).filter(Boolean);

  for (const color of safeColors.length ? safeColors : ["#D9D9D9"]) {
    addPaletteColorRow(color);
  }
}

function resetPaletteForm() {
  qs("#palette-modal-title").textContent = "新建配色";
  qs("#palette-form").reset();
  qs("#palette-id").value = "";
  qs("#palette-enabled").value = "true";
  renderPaletteColorEditor(["#D9D9D9"]);
}

function fillPaletteForm(palette) {
  qs("#palette-modal-title").textContent = "编辑配色";
  qs("#palette-id").value = palette.id;
  qs("#palette-name").value = palette.name;
  qs("#palette-description").value = palette.description;
  renderPaletteColorEditor(palette.colors);
  qs("#palette-prompt").value = palette.prompt;
  qs("#palette-enabled").value = String(palette.enabled);
}

async function savePalette(event) {
  event.preventDefault();
  const colors = getPaletteEditorColors();

  if (!colors.length) {
    alert("请至少配置一个有效的 Hex 色值。");
    return;
  }

  await requestJson("/api/config/color-palettes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: qs("#palette-id").value || undefined,
      name: qs("#palette-name").value,
      description: qs("#palette-description").value,
      colors,
      prompt: qs("#palette-prompt").value,
      enabled: boolValue(qs("#palette-enabled").value),
    }),
  });
  closeModals();
  await loadConfig();
}

async function deletePalette(paletteId) {
  const palette = state.colorPalettes.find((item) => item.id === paletteId);

  if (!palette || !confirm(`确认删除配色「${palette.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/color-palettes/${paletteId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

function resetShapeArchitectureForm() {
  qs("#shape-architecture-modal-title").textContent = "新建形状";
  qs("#shape-architecture-form").reset();
  qs("#shape-architecture-id").value = "";
  qs("#shape-architecture-enabled").value = "true";
}

function fillShapeArchitectureForm(architecture) {
  qs("#shape-architecture-modal-title").textContent = "编辑形状";
  qs("#shape-architecture-id").value = architecture.id;
  qs("#shape-architecture-name").value = architecture.name;
  qs("#shape-architecture-description").value = architecture.description;
  qs("#shape-architecture-prompt").value = architecture.prompt;
  qs("#shape-architecture-enabled").value = String(architecture.enabled);
}

async function saveShapeArchitecture(event) {
  event.preventDefault();
  await requestJson("/api/config/shape-architectures", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: qs("#shape-architecture-id").value || undefined,
      name: qs("#shape-architecture-name").value,
      description: qs("#shape-architecture-description").value,
      prompt: qs("#shape-architecture-prompt").value,
      enabled: boolValue(qs("#shape-architecture-enabled").value),
    }),
  });
  closeModals();
  await loadConfig();
}

async function deleteShapeArchitecture(architectureId) {
  const architecture = state.shapeArchitectures.find((item) => item.id === architectureId);

  if (!architecture || !confirm(`确认删除形状「${architecture.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/shape-architectures/${architectureId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

function resetScenarioForm() {
  qs("#scenario-modal-title").textContent = "新建运营场景";
  qs("#scenario-form").reset();
  qs("#scenario-id").value = "";
  qs("#scenario-enabled").value = "true";
}

function fillScenarioForm(scenario) {
  qs("#scenario-modal-title").textContent = "编辑运营场景";
  qs("#scenario-id").value = scenario.id;
  qs("#scenario-name").value = scenario.name;
  qs("#scenario-description").value = scenario.description;
  qs("#scenario-fixed-prompt").value = scenario.fixedPrompt || scenario.content || "";
  qs("#scenario-variable-prompt").value = scenario.variablePrompt || "";
  qs("#scenario-enabled").value = String(scenario.enabled);
}

async function saveScenario(event) {
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

async function deleteScenario(scenarioId) {
  const scenario = state.operationScenarios.find((item) => item.id === scenarioId);

  if (!scenario || !confirm(`确认删除运营场景「${scenario.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/operation-scenarios/${scenarioId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

function resetScenarioAgentForm() {
  qs("#scenario-agent-modal-title").textContent = "新建场景 Skill";
  qs("#scenario-agent-form").reset();
  qs("#scenario-agent-id").value = "";
  qs("#scenario-agent-trigger").value = "/";
  qs("#scenario-agent-output-mode").value = "prompt_sections";
  qs("#scenario-agent-version").value = "v1.0";
  qs("#scenario-agent-driver-model").value = state.models.find((model) => model.purpose === "language")?.id || state.models[0]?.id || "";
  qs("#scenario-agent-enabled").value = "true";
}

function fillScenarioAgentForm(agent) {
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

async function saveScenarioAgent(event) {
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

async function deleteScenarioAgent(agentId) {
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

function resetScenarioAgentCaseForm() {
  qs("#scenario-agent-case-modal-title").textContent = "新建 Skill 案例";
  qs("#scenario-agent-case-form").reset();
  qs("#scenario-agent-case-id").value = "";
  qs("#scenario-agent-case-agent").value = state.scenarioAgents[0]?.id || "";
  qs("#scenario-agent-case-rating").value = "excellent";
  qs("#scenario-agent-case-enabled").value = "true";
  qs("#scenario-agent-case-image-file").value = "";
}

function fillScenarioAgentCaseForm(item) {
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

async function saveScenarioAgentCase(event) {
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

async function deleteScenarioAgentCase(caseId) {
  const item = state.scenarioAgentCases.find((caseItem) => caseItem.id === caseId);

  if (!item || !confirm(`确认删除案例「${item.title}」？`)) {
    return;
  }

  await requestJson(`/api/config/scenario-agent-cases/${caseId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

document.addEventListener("click", async (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

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
qs("#agent-md-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (file) {
    await importAgentFromMarkdown(file);
    event.target.value = "";
  }
});

loadConfig().catch((error) => {
  qs("#models-table").innerHTML = `<tr><td colspan="5">${error.message}</td></tr>`;
});
