const form = document.querySelector("#task-form");
const createTaskButton = document.querySelector("#create-task-button");
const errorMessage = document.querySelector("#error-message");
const stylePresetSelect = document.querySelector("#stylePresetId");
const taskId = document.querySelector("#task-id");
const taskMode = document.querySelector("#task-mode");
const styleName = document.querySelector("#style-name");
const promptPositive = document.querySelector("#prompt-positive");
const promptNegative = document.querySelector("#prompt-negative");
const preprocessSteps = document.querySelector("#preprocess-steps");
const resultsGrid = document.querySelector("#results-grid");
const providerPill = document.querySelector("#provider-pill");

function setError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function setLoading(isLoading) {
  createTaskButton.disabled = isLoading;
  createTaskButton.textContent = isLoading ? "任务生成中..." : "创建生成任务";
}

async function loadStylePresets() {
  const response = await fetch("/api/style-presets");
  const data = await response.json();

  stylePresetSelect.innerHTML = "";
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "不使用风格模板";
  stylePresetSelect.appendChild(emptyOption);

  for (const preset of data.stylePresets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    stylePresetSelect.appendChild(option);
  }
}

function renderPreprocessSteps(steps) {
  preprocessSteps.innerHTML = "";

  for (const step of steps) {
    const item = document.createElement("li");
    item.textContent = step;
    preprocessSteps.appendChild(item);
  }
}

function renderResults(task) {
  resultsGrid.innerHTML = "";

  for (const result of task.results) {
    const card = document.createElement("article");
    card.className = `result-card${result.selected ? " selected" : ""}`;

    const image = document.createElement("img");
    image.src = result.imageUrl;
    image.alt = `候选结果 ${result.rank}`;

    const meta = document.createElement("div");
    meta.className = "result-meta";
    const sizeLabel = result.width && result.height ? `${result.width} × ${result.height}` : "原始输出尺寸";
    meta.innerHTML = `
      ${result.selected ? '<span class="badge">当前选中</span>' : ""}
      <strong>图片 ${result.rank}</strong>
      <p>${sizeLabel}</p>
      <button type="button" data-result-id="${result.id}">选择这张图片</button>
    `;

    meta.querySelector("button").addEventListener("click", async () => {
      const response = await fetch(`/api/tasks/${task.id}/results/${result.id}/select`, {
        method: "POST",
      });
      const data = await response.json();
      renderTask(data.task);
    });

    card.append(image, meta);
    resultsGrid.appendChild(card);
  }
}

function renderTask(task) {
  taskId.textContent = task.id;
  taskMode.textContent = `${task.preprocess.detectedType} / ${task.preprocess.mode}`;
  styleName.textContent = task.stylePreset?.name || "未使用模板";
  promptPositive.textContent = task.prompt.positive;
  promptNegative.textContent = `负向提示词：${task.prompt.negative}`;
  providerPill.textContent = `provider: ${task.results[0]?.meta.provider || "mock"}`;
  renderPreprocessSteps(task.preprocess.steps);
  renderResults(task);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");
  setLoading(true);
  resultsGrid.innerHTML = '<div class="empty-state">正在执行完整链路：Input Parser → Preprocess → Style Engine → Prompt Builder → Image Provider...</div>';

  const asset = document.querySelector("#asset").files[0];
  const formData = new FormData();
  formData.append("inputType", document.querySelector("#inputType").value);
  formData.append("stylePresetId", stylePresetSelect.value);
  formData.append("source", "web_upload");
  formData.append("target", "web");
  formData.append("preserveStructure", document.querySelector("#preserveStructure").checked);
  formData.append("styleLock", document.querySelector("#styleLock").checked);
  formData.append("transparentBackground", document.querySelector("#transparentBackground").checked);
  formData.append("fidelityLevel", document.querySelector("#fidelityLevel").value);
  formData.append("variationStrength", document.querySelector("#variationStrength").value);
  formData.append("batchSize", "4");
  formData.append("aspectRatio", "1:1");
  formData.append("resolution", "1k");

  if (asset) {
    formData.append("asset", asset);
  } else {
    formData.append("filename", "web-placeholder.svg");
    formData.append("mimeType", "image/svg+xml");
    formData.append("sizeBytes", "0");
  }

  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "创建任务失败");
    }

    renderTask(data.task);
  } catch (error) {
    setError(error.message);
    resultsGrid.innerHTML = '<div class="empty-state">任务失败，请检查后端服务。</div>';
  } finally {
    setLoading(false);
  }
});

loadStylePresets().catch((error) => {
  setError(error.message);
});
