
      memberInviteCodeInput.addEventListener("input", () => {
        memberLoginStatus.textContent = "";
      });

      memberLogoutButton.addEventListener("click", async () => {
        memberLogoutButton.disabled = true;

        try {
          if (memberSessionToken) {
            await apiFetch("/api/member/session", {
              method: "DELETE",
            });
          }
        } finally {
          clearMemberSession();
          showMemberLogin("已退出当前成员账号。");
          memberLogoutButton.disabled = false;
        }
      });

      modelSelect.addEventListener("focus", loadConfig);
      agentSelect.addEventListener("focus", loadConfig);
      agentSelect.addEventListener("change", updateRunState);
      materialSelectButton.addEventListener("click", async () => {
        await loadConfig();
        cancelMaterialPanelAutoClose();
        closePalettePanel();
        materialPanel.classList.toggle("open");
      });
      materialSelectButton.addEventListener("mouseenter", openMaterialPanel);
      materialSelectButton.addEventListener("mouseleave", () => {
        if (materialPanel.classList.contains("open")) {
          scheduleMaterialPanelAutoClose();
        }
      });
      materialPanel.addEventListener("mouseenter", cancelMaterialPanelAutoClose);
      materialPanel.addEventListener("mouseleave", scheduleMaterialPanelAutoClose);
      colorPaletteSelect.addEventListener("focus", async () => {
        await loadConfig();
        openPalettePanel();
      });
      paletteSelectWrap.addEventListener("mouseenter", () => {
        cancelPalettePanelAutoClose();
        openPalettePanel();
      });
      paletteSelectWrap.addEventListener("mouseleave", () => {
        if (paletteInlineEditor.classList.contains("open")) {
          schedulePalettePanelAutoClose();
        }
      });
      aspectRatioSelect.addEventListener("change", () => {
        aspectRatio = aspectRatioSelect.value;
      });
      resolutionSelect.addEventListener("change", () => {
        resolution = resolutionSelect.value;
      });
      batchSizeSelect.addEventListener("change", () => {
        resolveBatchSize();
      });
      colorPaletteSelect.addEventListener("change", () => {
        colorPaletteId = colorPaletteSelect.value;
        customPaletteColors = [];
        renderPaletteInlineEditor({ resetColors: true });
        openPalettePanel();
        updateRunState();
      });
      pluginAddPaletteColorButton.addEventListener("click", () => {
        cancelPalettePanelAutoClose();
        addPluginPaletteColorRow();
      });
      paletteInlineEditor.addEventListener("mouseenter", cancelPalettePanelAutoClose);
      paletteInlineEditor.addEventListener("mouseleave", schedulePalettePanelAutoClose);
      document.addEventListener("pointermove", (event) => {
        if (!palettePanelDeletePointer) {
          return;
        }

        const deltaX = event.clientX - palettePanelDeletePointer.x;
        const deltaY = event.clientY - palettePanelDeletePointer.y;

        if ((deltaX * deltaX) + (deltaY * deltaY) < 16) {
          return;
        }

        palettePanelDeletePointer = null;
        const bounds = paletteInlineEditor.getBoundingClientRect();
        const isPointerInside = event.clientX >= bounds.left
          && event.clientX <= bounds.right
          && event.clientY >= bounds.top
          && event.clientY <= bounds.bottom;

        if (!isPointerInside && paletteInlineEditor.classList.contains("open")) {
          schedulePalettePanelAutoClose();
        }
      });
      shapeArchitectureSelect.addEventListener("focus", loadConfig);
      shapeArchitectureSelect.addEventListener("change", () => {
        shapeArchitectureId = shapeArchitectureSelect.value;
      });
      document.addEventListener("click", (event) => {
        if (!materialPanel.contains(event.target) && event.target !== materialSelectButton) {
          materialPanel.classList.remove("open");
        }

        if (!paletteInlineEditor.contains(event.target) && event.target !== colorPaletteSelect) {
          closePalettePanel();
        }

        if (!scenarioPanel.contains(event.target) && event.target !== messageInput) {
          hideScenarioPanel();
        }
      });
      addSelectionButton.addEventListener("click", syncCurrentSelection);
      sendButton.addEventListener("click", sendMessage);
      messageInput.addEventListener("input", () => {
        resizeMessageInput();
        updateRunState();
        renderScenarioSuggestions();
      });
      messageInput.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === "Tab") && scenarioPanel.classList.contains("open") && activeScenarioSuggestions[0]) {
          event.preventDefault();
          insertActiveScenarioSuggestion(activeScenarioSuggestions[0]);
          return;
        }

        if (event.key === "Escape" && scenarioPanel.classList.contains("open")) {
          event.preventDefault();
          hideScenarioPanel();
          return;
        }

        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          sendMessage();
        }
      });
      messageInput.addEventListener("click", renderScenarioSuggestions);
      setupResizeHandle();
      resizeMessageInput();
      window.addEventListener("resize", scrollComposerActionsIntoView);
      window.addEventListener("load", scheduleInitialComposerActionsScroll);
      scheduleInitialComposerActionsScroll();

      window.onmessage = (event) => {
        const message = event.data.pluginMessage;

        if (!message) {
          return;
        }

        if (message.type === "selection-synced") {
          const incomingAssets = message.payload.assets || [];
          selectedAssets = mergeSelectedAssets(message.payload.assets || []);
          updateAspectRatioAutoLabel();
          renderAttachments();
          selectionBar.textContent = selectedAssets.length
            ? `已添加 ${selectedAssets.length} 张参考图，按选择顺序标为图1、图2。可点击缩略图右上角删除。`
            : message.payload.message;
          selectionStatus.textContent = incomingAssets.length
            ? `已添加 ${selectedAssets.length} 张参考图，按选择顺序标为图1、图2。`
            : message.payload.message;
          addSelectionButton.disabled = false;
          updateRunState();
        }

        if (message.type === "selection-error") {
          selectionBar.textContent = message.message;
          selectionStatus.textContent = message.message;
          addSelectionButton.disabled = false;
        }

        if (message.type === "insert-result-finished") {
          const pending = pendingInsertButtons.get(message.requestId);

          if (pending) {
            pending.button.textContent = message.ok ? "已插入" : pending.originalText;
            pending.button.disabled = false;
            pendingInsertButtons.delete(message.requestId);

            if (message.ok) {
              window.setTimeout(() => {
                pending.button.textContent = pending.originalText;
              }, 1200);
            }
          }

          if (!message.ok) {
            addMessage("system", message.message || "插入 Figma 失败。");
          }
        }
      };
