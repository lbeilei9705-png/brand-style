      async function ensureConversation(signal) {
        if (activeConversationId) {
          return activeConversationId;
        }

        const response = await apiFetch("/api/conversations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            modelId: modelSelect.value,
            agentId: agentSelect.value,
          }),
          signal,
        });
        const data = await response.json();
        if (!response.ok || !data.conversation) {
          throw createApiError(response, data, "创建对话失败");
        }
        activeConversationId = data.conversation.id;
        return activeConversationId;
      }

      async function submitConversationMessage(content, messageAttachments, inputType = "auto", hasRetried = false, signal) {
        const conversationId = await ensureConversation(signal);
        const directPrompt = buildDirectPromptFromScenarioDraft(content);
        const currentBatchSize = resolveBatchSize();
        const response = await apiFetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content,
            modelId: modelSelect.value,
            agentId: agentSelect.value,
            inputType,
            selectionAssets: messageAttachments,
            batchSize: currentBatchSize,
            aspectRatio: resolveAspectRatio(),
            resolution,
            materialPresetIds,
            colorPaletteId,
            customColorPalette: getCustomColorPalettePayload(),
            shapeArchitectureId,
            operationScenarioId: selectedOperationScenarioId || undefined,
            directPrompt,
            usePromptOrchestrator: directPrompt ? false : hasPromptOrchestrationConfig(),
          }),
          signal,
        });
        const data = await response.json();

        if ((response.status === 404 || data.error === "Conversation not found.") && !hasRetried) {
          activeConversationId = null;
          return submitConversationMessage(content, messageAttachments, inputType, true, signal);
        }

        if (!response.ok) {
          if (data.quota && memberSession) {
            memberSession = {
              ...memberSession,
              ...data.quota,
            };
            renderMemberSession();
          }
          throw createApiError(response, data, "生成失败");
        }

        refreshMemberSession().catch(() => {});
        return data;
      }

      async function completeScenarioAgentPrompt(content, messageAttachments, signal) {
        const response = await apiFetch("/api/scenario-agent/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content,
            selectionAssets: messageAttachments,
          }),
          signal,
        });
        const data = await response.json();

        if (!response.ok) {
          throw createApiError(response, data, "场景智能体生成 Prompt 失败");
        }

        return data;
      }

      function isAbortError(error) {
        return error?.name === "AbortError";
      }

      function stopGeneration() {
        if (activeGenerationController) {
          trackEvent("generation_abort_requested");
          activeGenerationController.abort();
        }
      }

      function resolveBatchSize() {
        batchSize = Math.min(4, Math.max(1, Number(batchSizeSelect.value) || 1));
        batchSizeSelect.value = String(batchSize);
        return batchSize;
      }

      function hasPromptOrchestrationConfig() {
        return Boolean(
          agentSelect.value
          || materialPresetIds.length
          || colorPaletteId
          || customPaletteColors.length
          || shapeArchitectureId
          || selectedOperationScenarioId
        );
      }

      async function sendMessage() {
        if (isSending) {
          stopGeneration();
          return;
        }

        const content = messageInput.value.trim();

        if (!content && !selectedAssets.length) {
          return;
        }

        const hasConfig = Boolean(
          agentSelect.value
          || colorPaletteId
          || shapeArchitectureId
          || materialPresetIds.length
          || selectedOperationScenarioId
        );
        if (!content && selectedAssets.length && !hasConfig) {
          const hint = "请描述要怎么处理这张图，或选择一个风格/形状/配色/材质。";
          selectionStatus.textContent = hint;
          addMessage("system", hint);
          updateRunState();
          return;
        }

        const highestReferencedImageIndex = getHighestReferencedImageIndex(content);
        if (highestReferencedImageIndex > selectedAssets.length) {
          addMessage("system", `你提到了图${highestReferencedImageIndex}，但当前只添加了 ${selectedAssets.length} 张参考图。请先点击“添加选中图”把图${highestReferencedImageIndex}加进来。`);
          return;
        }

        const scenarioAgent = getScenarioAgentFromContent(content);
        const messageAttachments = getLabeledSelectedAssets();

        if (scenarioAgent) {
          const generationController = new AbortController();
          activeGenerationController = generationController;
          isSending = true;
          clearStyleSelectionsForScenarioAgent();
          updateRunState();
          const pending = addMessage("system", `正在调用「${scenarioAgent.name}」补全 Prompt...`);
          trackEvent("scenario_complete_start", {
            scenarioAgentId: scenarioAgent.id,
            selectionCount: messageAttachments.length,
          });

          try {
            const data = await completeScenarioAgentPrompt(content, messageAttachments, generationController.signal);
            messageInput.value = data.prompt;
            saveScenarioAgentDraft({
              scenarioAgentId: data.scenarioAgent?.agentId || scenarioAgent.id,
              promptMain: data.prompt,
              promptFixedPositive: data.promptFixedPositive || "",
              promptNegative: data.promptNegative || "",
            });
            const preferredAspectRatio = getPreferredAspectRatioForScenarioAgent(scenarioAgent, data.prompt);

            if (preferredAspectRatio) {
              aspectRatio = preferredAspectRatio;
              aspectRatioSelect.value = preferredAspectRatio;
            }
            resizeMessageInput();
            pending.textContent = data.promptNegative
              ? `「${scenarioAgent.name}」已生成 Prompt，已回填正向 Prompt，并会在生成时使用智能体负面提示词：${data.promptNegative}`
              : `「${scenarioAgent.name}」已生成 Prompt，已回填到输入框。你可以继续修改，确认后再点击生成。`;
            selectionStatus.textContent = "场景智能体已补全 Prompt；普通风格套装和自由搭配已清空。";
            trackEvent("scenario_complete_success", {
              scenarioAgentId: scenarioAgent.id,
              requestId: data.requestId,
            });
          } catch (error) {
            if (isAbortError(error)) {
              pending.textContent = "已暂停场景智能体补全。";
            } else {
              pending.remove();
              addMessage("system", getReadableError(error));
            }
            trackEvent(isAbortError(error) ? "scenario_complete_abort" : "scenario_complete_fail", {
              scenarioAgentId: scenarioAgent.id,
              issueId: isAbortError(error) ? undefined : ensureIssueId(error),
              requestId: error?.requestId,
            });
          } finally {
            isSending = false;
            if (activeGenerationController === generationController) {
              activeGenerationController = null;
            }
            updateRunState();
          }
          return;
        }

        const currentBatchSize = resolveBatchSize();
        const loadingText = currentBatchSize > 1
          ? `正在并发渲染 ${currentBatchSize} 张候选图...`
          : "正在渲染一种‘甲方闭嘴’的高级感...";
        let renderTimer;
        const generationController = new AbortController();
        activeGenerationController = generationController;
        isSending = true;
        updateRunState();
        const inputType = await inferInputType(messageAttachments, content);
        if (generationController.signal.aborted) {
          isSending = false;
          activeGenerationController = null;
          updateRunState();
          return;
        }

        if (content || messageAttachments.length) {
          addMessage("user", content, messageAttachments);
        }
        messageInput.value = "";
        resizeMessageInput();
        const pending = addMessage("system", `${loadingText} 已用 0 秒`);
        const startedAt = Date.now();
        trackEvent("generation_start", {
          batchSize: currentBatchSize,
          inputType,
          selectionCount: messageAttachments.length,
          modelId: modelSelect.value,
          agentId: agentSelect.value,
        });

        renderTimer = window.setInterval(() => {
          const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
          pending.textContent = `${loadingText} 已用 ${elapsedSeconds} 秒`;
        }, 1000);

        try {
          const data = await submitConversationMessage(content, messageAttachments, inputType, false, generationController.signal);
          pending.textContent = data.conversation.messages.at(-1).content;
          activeConversationId = data.conversation.id;
          renderResults(data.task);
          clearSelectionsAfterGeneration();
          trackEvent("generation_success", {
            durationMs: Date.now() - startedAt,
            resultCount: data.task?.results?.length || 0,
            conversationId: data.conversation.id,
          });
        } catch (error) {
          if (isAbortError(error)) {
            pending.textContent = "已暂停本次生成。";
          } else {
            pending.remove();
            addMessage("system", getReadableError(error));
          }
          trackEvent(isAbortError(error) ? "generation_abort" : "generation_fail", {
            durationMs: Date.now() - startedAt,
            issueId: isAbortError(error) ? undefined : ensureIssueId(error),
            requestId: error?.requestId,
          });
        } finally {
          window.clearInterval(renderTimer);
          selectedOperationScenarioId = "";
          isSending = false;
          if (activeGenerationController === generationController) {
            activeGenerationController = null;
          }
          updateRunState();
        }
      }

      function syncCurrentSelection() {
        addSelectionButton.disabled = true;
        selectionStatus.textContent = "正在添加当前选中图...";
        trackEvent("selection_start");
        parent.postMessage({ pluginMessage: { type: "sync-selection" } }, "*");
      }
