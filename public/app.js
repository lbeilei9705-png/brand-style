const form = document.querySelector("#generate-form");
const generateButton = document.querySelector("#generate-button");
const errorMessage = document.querySelector("#error-message");
const detectedType = document.querySelector("#detected-type");
const styleName = document.querySelector("#style-name");
const fileName = document.querySelector("#file-name");
const promptOutput = document.querySelector("#prompt-output");
const resultsGrid = document.querySelector("#results-grid");
const taskId = document.querySelector("#task-id");

const typeLabels = {
  line_sketch: "线稿",
  flat_icon: "扁平 icon",
};

function setError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function setLoading(isLoading) {
  generateButton.disabled = isLoading;
  generateButton.textContent = isLoading ? "生成中..." : "生成 4 张结果";
}

function renderResults(results) {
  resultsGrid.innerHTML = "";

  for (const result of results) {
    const card = document.createElement("article");
    card.className = `result-card${result.recommended ? " recommended" : ""}`;

    const image = document.createElement("img");
    image.src = result.imageDataUrl;
    image.alt = `候选结果 ${result.rank}`;

    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.innerHTML = `
      ${result.recommended ? '<span class="badge">推荐最佳</span>' : ""}
      <strong>候选 ${result.rank}<span class="score">${result.score}</span></strong>
      <p>${result.reason}</p>
    `;

    card.append(image, meta);
    resultsGrid.appendChild(card);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");
  setLoading(true);

  const formData = new FormData(form);
  formData.set("preserveStructure", document.querySelector("#preserveStructure").checked);
  formData.set("styleLock", document.querySelector("#styleLock").checked);
  formData.set("transparentBg", document.querySelector("#transparentBg").checked);

  resultsGrid.innerHTML = '<div class="empty-state">正在执行：预处理 → 风格映射 → Prompt Builder → 生成 4 张候选图...</div>';

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "生成失败");
    }

    detectedType.textContent = typeLabels[data.input.detectedType] || data.input.detectedType;
    styleName.textContent = data.stylePreset?.name || "未使用模板";
    fileName.textContent = data.input.filename;
    promptOutput.textContent = data.prompt;
    taskId.textContent = data.taskId;
    renderResults(data.results);
  } catch (error) {
    setError(error.message);
    resultsGrid.innerHTML = '<div class="empty-state">生成失败，请检查服务是否正常运行。</div>';
  } finally {
    setLoading(false);
  }
});
