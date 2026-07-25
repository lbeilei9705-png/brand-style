import { boolValue, closeModals, qs, requestJson, state, uploadAsset } from "./core.js";
import { loadConfig } from "./config.js";

export function resetMaterialForm() {
  qs("#material-modal-title").textContent = "新建材质";
  qs("#material-form").reset();
  qs("#material-id").value = "";
  qs("#material-enabled").value = "true";
  qs("#material-preview-image-file").value = "";
}

export function fillMaterialForm(material) {
  qs("#material-modal-title").textContent = "编辑材质";
  qs("#material-preview-image-file").value = "";
  qs("#material-id").value = material.id;
  qs("#material-name").value = material.name;
  qs("#material-prompt").value = material.prompt;
  qs("#material-preview-image-url").value = material.previewImageUrl || "";
  qs("#material-enabled").value = String(material.enabled);
}

export async function saveMaterial(event) {
  event.preventDefault();
  const submitButton = event.submitter || qs("#material-form button[type='submit']");
  const originalText = submitButton?.textContent || "保存材质";

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "保存中...";
  }

  try {
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
  } catch (error) {
    alert(error instanceof Error ? error.message : "保存材质失败");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

export async function deleteMaterial(materialId) {
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

export function addPaletteColorRow(color = "#D9D9D9") {
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

export function resetPaletteForm() {
  qs("#palette-modal-title").textContent = "新建配色";
  qs("#palette-form").reset();
  qs("#palette-id").value = "";
  qs("#palette-enabled").value = "true";
  renderPaletteColorEditor(["#D9D9D9"]);
}

export function fillPaletteForm(palette) {
  qs("#palette-modal-title").textContent = "编辑配色";
  qs("#palette-id").value = palette.id;
  qs("#palette-name").value = palette.name;
  qs("#palette-description").value = palette.description;
  renderPaletteColorEditor(palette.colors);
  qs("#palette-prompt").value = palette.prompt;
  qs("#palette-enabled").value = String(palette.enabled);
}

export async function savePalette(event) {
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

export async function deletePalette(paletteId) {
  const palette = state.colorPalettes.find((item) => item.id === paletteId);

  if (!palette || !confirm(`确认删除配色「${palette.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/color-palettes/${paletteId}`, {
    method: "DELETE",
  });
  await loadConfig();
}

export function resetShapeArchitectureForm() {
  qs("#shape-architecture-modal-title").textContent = "新建形状";
  qs("#shape-architecture-form").reset();
  qs("#shape-architecture-id").value = "";
  qs("#shape-architecture-enabled").value = "true";
}

export function fillShapeArchitectureForm(architecture) {
  qs("#shape-architecture-modal-title").textContent = "编辑形状";
  qs("#shape-architecture-id").value = architecture.id;
  qs("#shape-architecture-name").value = architecture.name;
  qs("#shape-architecture-description").value = architecture.description;
  qs("#shape-architecture-prompt").value = architecture.prompt;
  qs("#shape-architecture-enabled").value = String(architecture.enabled);
}

export async function saveShapeArchitecture(event) {
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

export async function deleteShapeArchitecture(architectureId) {
  const architecture = state.shapeArchitectures.find((item) => item.id === architectureId);

  if (!architecture || !confirm(`确认删除形状「${architecture.name}」？`)) {
    return;
  }

  await requestJson(`/api/config/shape-architectures/${architectureId}`, {
    method: "DELETE",
  });
  await loadConfig();
}
