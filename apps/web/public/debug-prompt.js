const state = {
  models: [],
  agents: [],
  materials: [],
  colorPalettes: [],
  shapeArchitectures: [],
  operationScenarios: [],
};

const accessTokenStorageKey = "brand-style-admin-token";
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const scenarios = [
  {
    id: "style-only",
    name: "只选风格套装",
    content: "生成一个金融活动用的3D图标",
    referenceCount: 0,
    expect: [
      { label: "不应追加手动配色要求", notIncludes: "手动配色方案" },
      { label: "应该包含用户输入", includes: "金融活动" },
    ],
  },
  {
    id: "manual-palette",
    name: "手动选择配色",
    content: "基于参考图做3D图标",
    referenceCount: 1,
    pickPalette: "firstManual",
    expect: [
      { label: "应该追加配色要求", includes: "配色要求" },
      { label: "应该保留参考图结构约束", includes: "结构要求" },
    ],
  },
  {
    id: "original-color",
    name: "原图色彩",
    content: "基于参考图做3D图标，保持图片色彩",
    referenceCount: 1,
    pickPalette: "original",
    expect: [
      { label: "应该明确保持原图色彩", includes: "保持参考图原有色彩" },
      { label: "不应出现色值重配色", notIncludes: "色值：" },
    ],
  },
  {
    id: "manual-material",
    name: "手动选择材质",
    content: "把参考图做成更精致的3D图标",
    referenceCount: 1,
    pickMaterial: true,
    expect: [
      { label: "应该追加材质要求", includes: "材质要求" },
      { label: "应该剔除风格套装低优先级材质段", removedReason: "manualMaterials" },
    ],
  },
  {
    id: "manual-shape",
    name: "手动选择形状",
    content: "基于参考图生成目标图标",
    referenceCount: 1,
    pickShape: true,
    expect: [
      { label: "应该追加形状/结构要求", includes: "结构要求" },
      { label: "应该剔除风格套装低优先级形状段", removedReason: "manualShape" },
    ],
  },
  {
    id: "text-only",
    name: "纯文字输入",
    content: "一个绿色小罐穿礼服坐在办公室，3D图标",
    referenceCount: 0,
    expect: [
      { label: "不应包含保持原图主体轮廓", notIncludes: "保持原图主体轮廓" },
      { label: "应该包含文字主体", includes: "绿色小罐" },
    ],
  },
  {
    id: "single-reference",
    name: "添加单张参考图",
    content: "基于这张图生成3D图标",
    referenceCount: 1,
    expect: [
      { label: "应该包含参考图生成规则", includes: "基于参考图" },
      { label: "应该包含结构要求", includes: "结构要求" },
    ],
  },
  {
    id: "multi-reference",
    name: "多图关系",
    content: "保持图2结构，参考图1材质、图3的色彩",
    referenceCount: 3,
    expect: [
      { label: "应该识别图1", includes: "图1" },
      { label: "应该识别图2", includes: "图2" },
      { label: "应该识别图3", includes: "图3" },
      { label: "应该包含跨图参考规则", includes: "跨图参考规则" },
      { label: "应该只提醒按用户图号关系执行", includes: "严格按用户本轮输入中的图号关系执行" },
      { label: "不应自动展开图2结构职责", notIncludes: "图2负责结构" },
      { label: "不应自动展开图1材质职责", notIncludes: "图1负责材质" },
      { label: "不应自动展开图3色彩职责", notIncludes: "图3负责色彩" },
      { label: "不应出现写死的图1结构图2材质示例", notIncludes: "保持图1结构，把图2材质用到图1上" },
      { label: "不应追加默认结构要求", notIncludes: "结构要求：保持原图主体轮廓" },
    ],
  },
  {
    id: "operation-scenario",
    name: "@运营场景",
    content: "春节活动主视觉，突出红包和金币",
    referenceCount: 1,
    pickOperation: true,
    expect: [
      { label: "应该使用运营场景", resolvedPath: "operationScenario" },
      { label: "不应追加普通配色要求", notIncludes: "配色要求" },
    ],
  },
  {
    id: "mock-model",
    name: "Mock测试模型",
    content: "生成一个测试用3D图标",
    referenceCount: 0,
    pickMockModel: true,
    expect: [
      { label: "应该选择 mock provider", resolvedProvider: "mock" },
    ],
  },
  {
    id: "scenario-miniature-world",
    name: "/微缩世界",
    content: "/微缩世界 提额春节活动，突出红包、金币和增长氛围",
    referenceCount: 3,
    usePromptOrchestrator: false,
    expect: [
      { label: "应该命中场景 Skill", scenarioAgentApplied: true },
      { label: "应该命中微缩世界 Skill", scenarioAgentId: "miniature-world" },
      { label: "应该返回最终 Prompt", scenarioPromptMain: true },
      { label: "应该使用结构化 Skill 卡", scenarioSkillIncludes: "结构化视觉生成 Skill" },
    ],
  },
  {
    id: "scenario-single-stage",
    name: "/单体舞台",
    content: "/单体舞台 额度锦鲤周，春日，IP手拿鱼竿钓到一个红包",
    referenceCount: 3,
    usePromptOrchestrator: false,
    expect: [
      { label: "应该命中场景 Skill", scenarioAgentApplied: true },
      { label: "应该命中单体舞台 Skill", scenarioAgentId: "single-stage" },
      { label: "应该返回 prompt_main", scenarioPromptMain: true },
      { label: "应该返回 prompt_negative", scenarioPromptNegative: true },
      { label: "负面提示词应该限制镜头", scenarioNegativeIncludes: "禁止俯视" },
    ],
  },
];

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
    throw new Error("需要后台访问 token 才能测试。");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

function enabled(items) {
  return items.filter((item) => item.enabled !== false);
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;

  return item;
}

function fillSelect(select, items, emptyLabel) {
  select.innerHTML = "";

  if (emptyLabel) {
    select.appendChild(option("", emptyLabel));
  }

  for (const item of items) {
    select.appendChild(option(item.id, item.name));
  }
}

function getFirstImageModel() {
  return enabled(state.models).find((model) => (model.purpose || "image") === "image") || enabled(state.models)[0];
}

function getDefaultAgent() {
  return enabled(state.agents)[0];
}

function getManualPalette() {
  return enabled(state.colorPalettes).find((palette) => !palette.name.includes("原图色彩"));
}

function getOriginalPalette() {
  return enabled(state.colorPalettes).find((palette) => palette.name.includes("原图色彩"));
}

function isScenarioAgentScenario(scenario) {
  return scenario.content.trim().startsWith("/");
}

function applyScenario(scenarioId) {
  const scenario = scenarios.find((item) => item.id === scenarioId) || scenarios[0];
  const isScenarioAgent = isScenarioAgentScenario(scenario);
  const model = scenario.pickMockModel
    ? enabled(state.models).find((item) => item.provider === "mock") || getFirstImageModel()
    : getFirstImageModel();
  const agent = isScenarioAgent ? undefined : getDefaultAgent();
  const palette = !isScenarioAgent && scenario.pickPalette === "original"
    ? getOriginalPalette()
    : !isScenarioAgent && scenario.pickPalette === "firstManual"
      ? getManualPalette()
      : undefined;
  const shape = !isScenarioAgent && scenario.pickShape ? enabled(state.shapeArchitectures)[0] : undefined;
  const material = !isScenarioAgent && scenario.pickMaterial ? enabled(state.materials)[0] : undefined;
  const operation = !isScenarioAgent && scenario.pickOperation ? enabled(state.operationScenarios)[0] : undefined;

  qs("#content-input").value = scenario.content;
  qs("#model-select").value = model?.id || "";
  qs("#agent-select").value = agent?.id || "";
  qs("#palette-select").value = palette?.id || "";
  qs("#shape-select").value = shape?.id || "";
  qs("#operation-select").value = operation?.id || "";
  qs("#reference-count-select").value = String(scenario.referenceCount || 0);
  qs("#input-type-select").value = "auto";
  qs("#orchestrator-checkbox").checked = scenario.usePromptOrchestrator !== false;

  for (const optionItem of qs("#material-select").options) {
    optionItem.selected = Boolean(material && optionItem.value === material.id);
  }
}

function buildSelectionAssets(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `debug_asset_${index + 1}`,
    referenceLabel: `图${index + 1}`,
    name: `测试参考图${index + 1}`,
    filename: index === 1 ? "material-reference.png" : "structure-reference.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    width: 1024,
    height: 1024,
    assetDataUrl: tinyPng,
  }));
}

function buildRequestFromForm(overrides = {}) {
  const materialPresetIds = Array.from(qs("#material-select").selectedOptions).map((item) => item.value).filter(Boolean);
  const referenceCount = Number(qs("#reference-count-select").value || 0);

  return {
    content: qs("#content-input").value,
    modelId: qs("#model-select").value,
    agentId: qs("#agent-select").value,
    inputType: qs("#input-type-select").value,
    selectionAssets: buildSelectionAssets(referenceCount),
    batchSize: 4,
    aspectRatio: "1:1",
    resolution: "2k",
    materialPresetIds,
    colorPaletteId: qs("#palette-select").value || undefined,
    shapeArchitectureId: qs("#shape-select").value || undefined,
    operationScenarioId: qs("#operation-select").value || undefined,
    usePromptOrchestrator: qs("#orchestrator-checkbox").checked,
    ...overrides,
  };
}

async function runDebugRequest(request) {
  return requestJson("/api/debug-prompt", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

function getByPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function evaluateExpectations(result, scenario) {
  const combinedPrompt = `${result.positivePrompt}\n${result.negativePrompt}`;
  const scenarioAgent = result.scenarioAgent || {};
  const scenarioCombined = [
    scenarioAgent.rawOutput,
    JSON.stringify(scenarioAgent.parsedOutput || {}),
    scenarioAgent.promptMain,
    scenarioAgent.promptNegative,
    scenarioAgent.skillSystemPrompt,
    scenarioAgent.memoryContext,
  ].join("\n");

  return (scenario.expect || []).map((expectation) => {
    let passed = true;

    if (expectation.includes) {
      passed = combinedPrompt.includes(expectation.includes);
    }

    if (expectation.notIncludes) {
      passed = !combinedPrompt.includes(expectation.notIncludes);
    }

    if (expectation.removedReason) {
      passed = result.removedLowPrioritySegments.some((segment) => segment.reason === expectation.removedReason);
    }

    if (expectation.resolvedPath) {
      passed = Boolean(getByPath(result.resolvedConfig, expectation.resolvedPath));
    }

    if (expectation.resolvedProvider) {
      passed = result.resolvedConfig.model?.provider === expectation.resolvedProvider;
    }

    if (expectation.scenarioAgentApplied !== undefined) {
      passed = Boolean(scenarioAgent.isScenarioAgentApplied) === expectation.scenarioAgentApplied;
    }

    if (expectation.scenarioAgentId) {
      passed = scenarioAgent.agentId === expectation.scenarioAgentId;
    }

    if (expectation.scenarioPromptMain) {
      passed = Boolean(scenarioAgent.promptMain);
    }

    if (expectation.scenarioPromptNegative) {
      passed = Boolean(scenarioAgent.promptNegative);
    }

    if (expectation.scenarioIncludes) {
      passed = scenarioCombined.includes(expectation.scenarioIncludes);
    }

    if (expectation.scenarioNegativeIncludes) {
      passed = String(scenarioAgent.promptNegative || "").includes(expectation.scenarioNegativeIncludes);
    }

    if (expectation.scenarioSkillIncludes) {
      passed = String(scenarioAgent.skillSystemPrompt || "").includes(expectation.scenarioSkillIncludes);
    }

    return { label: expectation.label, passed };
  });
}

function renderAssertions(assertions) {
  if (!assertions.length) {
    return "";
  }

  return `<div class="assertions">${assertions.map((item) => (
    `<span class="pill${item.passed ? "" : " fail"}">${item.passed ? "通过" : "不通过"}：${item.label}</span>`
  )).join("")}</div>`;
}

function renderSingleResult(result, scenario) {
  const assertions = evaluateExpectations(result, scenario);
  const removedText = result.removedLowPrioritySegments.length
    ? JSON.stringify(result.removedLowPrioritySegments, null, 2)
    : "没有剔除低优先级片段";
  const scenarioAgentHtml = renderScenarioAgent(result.scenarioAgent);

  if (result.scenarioAgent?.isScenarioAgentApplied) {
    qs("#single-result").innerHTML = `
      ${scenarioAgentHtml}
      ${renderAssertions(assertions)}
      <h2 style="margin-top:16px;">resolvedConfig</h2>
      <pre>${escapeHtml(JSON.stringify(result.resolvedConfig, null, 2))}</pre>
    `;
    return;
  }

  qs("#single-result").innerHTML = `
    ${scenarioAgentHtml}
    <div class="result-grid">
      <div>
        <h2>Positive Prompt</h2>
        <div class="prompt-box">${escapeHtml(result.positivePrompt)}</div>
      </div>
      <div>
        <h2>Negative Prompt</h2>
        <div class="prompt-box">${escapeHtml(result.negativePrompt)}</div>
      </div>
      <div>
        <h2>resolvedConfig</h2>
        <pre>${escapeHtml(JSON.stringify(result.resolvedConfig, null, 2))}</pre>
      </div>
      <div>
        <h2>removedLowPrioritySegments</h2>
        <pre>${escapeHtml(removedText)}</pre>
      </div>
    </div>
    ${renderAssertions(assertions)}
    ${result.promptOrchestratorError ? `<p class="error">语言模型编排失败，已回退到后端规则：${escapeHtml(result.promptOrchestratorError)}</p>` : ""}
    <h2 style="margin-top:16px;">finalModelPayload</h2>
    <pre>${escapeHtml(JSON.stringify(result.finalModelPayload, null, 2))}</pre>
  `;
}

function renderScenarioAgent(scenarioAgent) {
  if (!scenarioAgent?.isScenarioAgentApplied) {
    return "";
  }

  if (scenarioAgent.error) {
    return `
      <h2>Scenario Skill</h2>
      <div class="error">${escapeHtml(scenarioAgent.error)}</div>
    `;
  }

  return `
    <h2>Scenario Skill</h2>
    <div class="result-grid" style="margin-bottom:16px;">
      <div>
        <h2>命中信息</h2>
        <pre>${escapeHtml(JSON.stringify({
          trigger: scenarioAgent.trigger,
          agentId: scenarioAgent.agentId,
          agentName: scenarioAgent.agentName,
          userTheme: scenarioAgent.userTheme,
          referenceCount: scenarioAgent.referenceCount,
          retrievedCases: scenarioAgent.retrievedCases || [],
        }, null, 2))}</pre>
      </div>
      <div>
        <h2>结构化 Skill System Prompt</h2>
        <pre>${escapeHtml(scenarioAgent.skillSystemPrompt || "未返回")}</pre>
      </div>
      <div>
        <h2>上下文记忆摘要</h2>
        <pre>${escapeHtml(scenarioAgent.memoryContext || "未命中")}</pre>
      </div>
      <div>
        <h2>结构化输出</h2>
        <pre>${escapeHtml(JSON.stringify(scenarioAgent.parsedOutput || {}, null, 2))}</pre>
      </div>
      <div>
        <h2>prompt_main / finalPrompt</h2>
        <div class="prompt-box">${escapeHtml(scenarioAgent.promptMain || "未返回")}</div>
      </div>
      <div>
        <h2>prompt_negative</h2>
        <div class="prompt-box">${escapeHtml(scenarioAgent.promptNegative || "微缩世界 Skill 不单独返回负面提示词")}</div>
      </div>
    </div>
    <h2>Scenario Skill Raw Output</h2>
    <pre style="margin-bottom:16px;">${escapeHtml(scenarioAgent.rawOutput || "")}</pre>
  `;
}

function renderBatchResult(rows) {
  qs("#batch-result").innerHTML = rows.map((row) => {
    if (row.error) {
      return `
        <div class="test-row">
          <strong>${row.name}</strong>
          <div class="error">${escapeHtml(row.error)}</div>
          <span class="pill fail">失败</span>
        </div>
      `;
    }

    const failed = row.assertions.filter((item) => !item.passed).length;
    const statusClass = failed ? " fail" : "";
    const statusText = failed ? `${failed} 条不通过` : "通过";
    const previewText = row.result.scenarioAgent?.isScenarioAgentApplied
      ? (row.result.scenarioAgent.promptMain || row.result.scenarioAgent.rawOutput || "").slice(0, 220)
      : row.result.positivePrompt.slice(0, 220);

    return `
      <div class="test-row">
        <strong>${row.name}</strong>
        <div>
          <div class="muted">${escapeHtml(previewText)}${previewText.length >= 220 ? "..." : ""}</div>
          ${renderAssertions(row.assertions)}
        </div>
        <span class="pill${statusClass}">${statusText}</span>
      </div>
    `;
  }).join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function runCurrentScenario() {
  const button = qs("#run-button");
  const scenario = scenarios.find((item) => item.id === qs("#scenario-select").value) || scenarios[0];

  button.disabled = true;
  button.textContent = "测试中...";

  try {
    const result = await runDebugRequest(buildRequestFromForm());
    renderSingleResult(result, scenario);
  } catch (error) {
    qs("#single-result").innerHTML = `<div class="error">${escapeHtml(error.message || error)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = "测试当前场景";
  }
}

async function runAllScenarios() {
  const button = qs("#run-all-button");
  const previousScenarioId = qs("#scenario-select").value;
  const rows = [];

  button.disabled = true;
  button.textContent = "批量测试中...";

  for (const scenario of scenarios) {
    qs("#scenario-select").value = scenario.id;
    applyScenario(scenario.id);

    try {
      const result = await runDebugRequest(buildRequestFromForm());
      rows.push({
        name: scenario.name,
        result,
        assertions: evaluateExpectations(result, scenario),
      });
    } catch (error) {
      rows.push({
        name: scenario.name,
        error: error.message || String(error),
      });
    }

    renderBatchResult(rows);
  }

  qs("#scenario-select").value = previousScenarioId;
  applyScenario(previousScenarioId);
  button.disabled = false;
  button.textContent = "批量测试";
}

async function loadConfig() {
  const [models, styleSkills, materials, colorPalettes, shapeArchitectures, operationScenarios] = await Promise.all([
    requestJson("/api/config/models"),
    requestJson("/api/config/style-skills"),
    requestJson("/api/config/materials"),
    requestJson("/api/config/color-palettes"),
    requestJson("/api/config/shape-architectures"),
    requestJson("/api/config/operation-scenarios"),
  ]);

  state.models = models.models || [];
  state.agents = styleSkills.styleSkills || [];
  state.materials = materials.materials || [];
  state.colorPalettes = colorPalettes.colorPalettes || [];
  state.shapeArchitectures = shapeArchitectures.shapeArchitectures || [];
  state.operationScenarios = operationScenarios.operationScenarios || [];

  fillSelect(qs("#model-select"), enabled(state.models).filter((model) => (model.purpose || "image") === "image"), "");
  fillSelect(qs("#agent-select"), enabled(state.agents), "不选择风格套装");
  fillSelect(qs("#palette-select"), enabled(state.colorPalettes), "不选择配色");
  fillSelect(qs("#shape-select"), enabled(state.shapeArchitectures), "不选择形状");
  fillSelect(qs("#material-select"), enabled(state.materials), "");
  fillSelect(qs("#operation-select"), enabled(state.operationScenarios), "不使用运营场景");

  qs("#scenario-select").innerHTML = "";
  for (const scenario of scenarios) {
    qs("#scenario-select").appendChild(option(scenario.id, scenario.name));
  }

  applyScenario(scenarios[0].id);
}

qs("#scenario-select").addEventListener("change", (event) => applyScenario(event.target.value));
qs("#run-button").addEventListener("click", runCurrentScenario);
qs("#run-all-button").addEventListener("click", runAllScenarios);

loadConfig().catch((error) => {
  qs("#single-result").innerHTML = `<div class="error">${escapeHtml(error.message || error)}</div>`;
});
