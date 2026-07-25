
      document.querySelector("#new-chat-button").addEventListener("click", async () => {
        await loadConfig();
        const conversationIdToDelete = activeConversationId;
        activeConversationId = null;

        if (conversationIdToDelete) {
          apiFetch(`/api/conversations/${conversationIdToDelete}`, {
            method: "DELETE",
          }).catch(() => {
            // Retention cleanup will remove the conversation if immediate deletion fails.
          });
        }

        agentSelect.value = "";
        aspectRatioSelect.value = "auto";
        resolutionSelect.value = "2k";
        batchSizeSelect.value = "1";
        colorPaletteSelect.value = "";
        shapeArchitectureSelect.value = "";
        aspectRatio = "auto";
        resolution = "2k";
        batchSize = 1;
        selectedAssets = [];
        materialPresetIds = [];
        colorPaletteId = "";
        customPaletteColors = [];
        shapeArchitectureId = "";
        selectedOperationScenarioId = "";
        clearScenarioAgentDraft();
        messageInput.value = "";
        resizeMessageInput();
        selectionBar.textContent = "正在读取当前选区...";
        selectionStatus.textContent = "打开插件不会自动读取选区。";
        updateAspectRatioAutoLabel();
        closePalettePanel();
        renderPaletteInlineEditor({ resetColors: true });
        renderMaterialPanel();
        renderAttachments();
        chat.innerHTML = "";
        addMessage("system", "已清空当前面板。请选择画布对象并描述本轮需求。");
        updateRunState();
      });

      async function submitMemberLogin() {
        if (memberLoginButton.dataset.loading === "true") {
          return;
        }

        const code = memberInviteCodeInput.value.trim();

        if (!code) {
          memberLoginStatus.textContent = "请输入成员邀请码。";
          memberInviteCodeInput.focus();
          return;
        }

        memberLoginButton.dataset.loading = "true";
        memberLoginButton.disabled = true;
        memberLoginButton.textContent = "验证中...";
        memberLoginStatus.textContent = "";
        trackEvent("login_start");

        try {
          const response = await apiFetch("/api/member/session/redeem", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ code }),
            skipAuth: true,
          });
          const data = await response.json().catch(() => ({}));

          if (!response.ok || !data.sessionToken || !data.session) {
            throw createApiError(response, data, "邀请码验证失败。");
          }

          saveMemberSession(data.sessionToken, data.session);
          hideMemberLogin();
          isCollapsed = false;
          document.body.classList.remove("is-collapsed");
          collapseButton.title = "收起插件";
          collapseButton.setAttribute("aria-label", "收起插件");
          chat.innerHTML = "";
          addMessage("system", "登录成功。请选择画布对象并描述本轮需求。");
          trackEvent("login_success");

          try {
            await loadConfig();
          } catch (loadError) {
            addMessage("system", getReadableError(loadError));
          }

          updateRunState();
          scheduleInitialComposerActionsScroll();
        } catch (error) {
          trackEvent("login_fail", { issueId: ensureIssueId(error), requestId: error?.requestId });
          showMemberLogin(getReadableError(error));
          memberLoginStatus.textContent = getReadableError(error);
        } finally {
          memberLoginButton.dataset.loading = "";
          memberLoginButton.disabled = false;
          memberLoginButton.textContent = "验证并进入";
        }
      }
