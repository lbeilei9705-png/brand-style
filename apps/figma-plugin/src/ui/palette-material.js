      function scheduleInitialComposerActionsScroll() {
        scrollComposerActionsIntoView();
        setTimeout(scrollComposerActionsIntoView, 80);
        setTimeout(scrollComposerActionsIntoView, 240);
        setTimeout(scrollComposerActionsIntoView, 600);
      }

      function updateMaterialButton() {
        if (!materialPresetIds.length) {
          materialSelectButton.textContent = "未选择材质";
          return;
        }

        materialSelectButton.textContent = materialPresetIds.length === 1
          ? materials.find((item) => item.id === materialPresetIds[0])?.name || "材质 1"
          : `材质 ${materialPresetIds.length}`;
      }

      function cancelMaterialPanelAutoClose() {
        if (materialPanelCloseTimer) {
          clearTimeout(materialPanelCloseTimer);
          materialPanelCloseTimer = null;
        }
      }

      function scheduleMaterialPanelAutoClose() {
        cancelMaterialPanelAutoClose();
        materialPanelCloseTimer = setTimeout(() => {
          materialPanel.classList.remove("open");
          materialPanelCloseTimer = null;
        }, 220);
      }

      function openMaterialPanel() {
        if (!materialPresetIds.length) {
          return;
        }

        cancelMaterialPanelAutoClose();
        closePalettePanel();
        materialPanel.classList.add("open");
      }

      function cancelPalettePanelAutoClose() {
        if (palettePanelCloseTimer) {
          clearTimeout(palettePanelCloseTimer);
          palettePanelCloseTimer = null;
        }
      }

      function openPalettePanel() {
        if (!getSelectedColorPalette()) {
          return;
        }

        cancelPalettePanelAutoClose();
        materialPanel.classList.remove("open");
        paletteInlineEditor.classList.add("open");
      }

      function closePalettePanel() {
        cancelPalettePanelAutoClose();
        palettePanelDeletePointer = null;
        paletteInlineEditor.classList.remove("open");
      }

      function schedulePalettePanelAutoClose() {
        if (palettePanelDeletePointer) {
          return;
        }

        cancelPalettePanelAutoClose();
        palettePanelCloseTimer = setTimeout(() => {
          if (paletteInlineEditor.contains(document.activeElement)) {
            palettePanelCloseTimer = null;
            return;
          }

          closePalettePanel();
          palettePanelCloseTimer = null;
        }, 220);
      }

      function resolveMaterialPreviewUrl(url) {
        const value = String(url || "").trim();

        if (!value) {
          return "";
        }

        if (/^(https?:|data:|blob:)/i.test(value)) {
          return value;
        }

        return `${apiBase}${value.startsWith("/") ? value : `/${value}`}`;
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

      function getSelectedColorPalette() {
        return colorPalettes.find((palette) => palette.id === colorPaletteId);
      }

      function getSafePaletteColors(palette) {
        return (palette?.colors || []).map(normalizeHexColor).filter(Boolean);
      }

      function havePaletteColorsChanged(palette) {
        const original = getSafePaletteColors(palette);

        if (!original.length || original.length !== customPaletteColors.length) {
          return Boolean(customPaletteColors.length);
        }

        return original.some((color, index) => color !== customPaletteColors[index]);
      }

      function renderPaletteSwatches() {
        paletteSwatchRow.innerHTML = "";

        for (const color of customPaletteColors) {
          const swatch = document.createElement("span");
          swatch.className = "palette-swatch";
          swatch.title = color;
          swatch.style.background = color;
          paletteSwatchRow.appendChild(swatch);
        }
      }

      function syncCustomPaletteColorsFromRows() {
        customPaletteColors = [...pluginPaletteColorList.querySelectorAll("[data-plugin-palette-color]")]
          .map((input) => normalizeHexColor(input.value))
          .filter(Boolean);
        renderPaletteSwatches();
      }

      function addPluginPaletteColorRow(color = "#D9D9D9") {
        const normalized = normalizeHexColor(color) || "#D9D9D9";
        const row = document.createElement("div");
        row.className = "plugin-palette-color-row";
        row.innerHTML = `
          <input type="color" value="${normalized}" aria-label="选择颜色" />
          <input data-plugin-palette-color type="text" value="${normalized}" placeholder="#D9D9D9" />
          <button class="plugin-palette-color-remove" type="button">删除</button>
        `;
        const colorInput = row.querySelector('input[type="color"]');
        const textInput = row.querySelector("[data-plugin-palette-color]");
        const removeButton = row.querySelector(".plugin-palette-color-remove");
        colorInput.addEventListener("input", () => {
          textInput.value = normalizeHexColor(colorInput.value) || colorInput.value.toUpperCase();
          syncCustomPaletteColorsFromRows();
        });
        textInput.addEventListener("input", () => {
          const nextColor = normalizeHexColor(textInput.value);

          if (nextColor) {
            colorInput.value = nextColor;
          }

          syncCustomPaletteColorsFromRows();
        });
        textInput.addEventListener("blur", () => {
          textInput.value = normalizeHexColor(textInput.value) || normalized;
          colorInput.value = textInput.value;
          syncCustomPaletteColorsFromRows();
        });
        removeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          cancelPalettePanelAutoClose();
          palettePanelDeletePointer = {
            x: event.clientX,
            y: event.clientY,
          };
          row.remove();
          syncCustomPaletteColorsFromRows();
        });
        pluginPaletteColorList.appendChild(row);
        syncCustomPaletteColorsFromRows();
      }

      function renderPluginPaletteColorRows() {
        pluginPaletteColorList.innerHTML = "";

        for (const color of customPaletteColors.length ? customPaletteColors : ["#D9D9D9"]) {
          addPluginPaletteColorRow(color);
        }
      }

      function renderPaletteInlineEditor({ resetColors = false } = {}) {
        const palette = getSelectedColorPalette();

        if (!palette) {
          paletteInlineEditor.hidden = true;
          paletteInlineEditor.classList.remove("open");
          paletteEditorPanel.hidden = true;
          customPaletteColors = [];
          return;
        }

        if (resetColors || !customPaletteColors.length) {
          customPaletteColors = getSafePaletteColors(palette);
        }

        paletteInlineEditor.hidden = false;
        paletteEditorPanel.hidden = false;
        renderPaletteSwatches();
        renderPluginPaletteColorRows();
      }

      function getCustomColorPalettePayload() {
        const palette = getSelectedColorPalette();

        if (!palette || !havePaletteColorsChanged(palette)) {
          return undefined;
        }

        return {
          name: `${palette.name}（本次微调）`,
          description: "来自插件前台临时调色",
          colors: customPaletteColors,
          prompt: `本次自定义配色：${customPaletteColors.join("、")}。必须将这些颜色作为画面主要可见配色执行。`,
        };
      }

      function renderMaterialPanel() {
        materialPanel.innerHTML = "";
        const header = document.createElement("div");
        header.className = "multi-select-panel-header";
        const clearButton = document.createElement("button");
        clearButton.className = "multi-select-clear-button";
        clearButton.type = "button";
        clearButton.textContent = "取消全部勾选";
        clearButton.disabled = !materialPresetIds.length;
        clearButton.addEventListener("click", (event) => {
          event.stopPropagation();
          materialPresetIds = [];
          renderMaterialPanel();
          updateRunState();
        });
        header.appendChild(clearButton);
        materialPanel.appendChild(header);

        for (const material of materials) {
          const label = document.createElement("label");
          const isSelected = materialPresetIds.includes(material.id);
          label.className = `material-option${isSelected ? " selected" : ""}`;
          label.title = material.prompt || material.name;
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = material.id;
          checkbox.checked = isSelected;
          checkbox.addEventListener("change", () => {
            materialPresetIds = checkbox.checked
              ? [...materialPresetIds, material.id]
              : materialPresetIds.filter((id) => id !== material.id);
            label.classList.toggle("selected", checkbox.checked);
            clearButton.disabled = !materialPresetIds.length;
            updateMaterialButton();
            updateRunState();
          });
          const preview = document.createElement("div");
          const previewImageUrl = resolveMaterialPreviewUrl(material.previewImageUrl);
          preview.className = "material-preview";

          if (previewImageUrl) {
            const image = document.createElement("img");
            image.src = previewImageUrl;
            image.alt = material.name;
            image.loading = "lazy";
            image.addEventListener("error", () => {
              preview.innerHTML = "";
              const fallback = document.createElement("span");
              fallback.className = "material-preview-fallback";
              fallback.style.setProperty("--material-preview-color", material.previewColor || "#d7dce2");
              preview.appendChild(fallback);
            });
            preview.appendChild(image);
          } else {
            const fallback = document.createElement("span");
            fallback.className = "material-preview-fallback";
            fallback.style.setProperty("--material-preview-color", material.previewColor || "#d7dce2");
            preview.appendChild(fallback);
          }

          const text = document.createElement("span");
          text.textContent = material.name;
          label.append(checkbox, preview, text);
          materialPanel.appendChild(label);
        }

        updateMaterialButton();
      }

      function clearSelectionsAfterGeneration() {
        updateAspectRatioAutoLabel();
        renderAttachments();
        renderMaterialPanel();
        renderScenarioSuggestions();
        selectionBar.textContent = selectedAssets.length
          ? `已保留 ${selectedAssets.length} 张参考图`
          : "当前没有参考图。点击“添加选中图”可添加。";
        selectionStatus.textContent = "生成完成，已保留本次参考图和配置选项。";
      }

      function clearStyleSelectionsForScenarioAgent() {
        materialPresetIds = [];
        colorPaletteId = "";
        customPaletteColors = [];
        shapeArchitectureId = "";
        selectedOperationScenarioId = "";
        clearScenarioAgentDraft();
        agentSelect.value = "";
        colorPaletteSelect.value = "";
        shapeArchitectureSelect.value = "";
        materialPanel.classList.remove("open");
        closePalettePanel();
        renderPaletteInlineEditor({ resetColors: true });
        renderMaterialPanel();
        updateRunState();
      }

