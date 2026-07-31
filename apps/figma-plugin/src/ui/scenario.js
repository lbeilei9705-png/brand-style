      function getScenarioAgentFromContent(content) {
        const trimmed = content.trim();

        return scenarioAgents.find((agent) => agent.enabled !== false && (
          trimmed === agent.trigger || trimmed.startsWith(`${agent.trigger} `)
        ));
      }

      function normalizeScenarioDraftPrompt(value) {
        return (value || "").replace(/\s+/g, " ").trim();
      }

      function clearScenarioAgentDraft() {
        scenarioAgentDraft = null;

        try {
          sessionStorage.removeItem(scenarioAgentDraftStorageKey);
        } catch {
          // Storage is best-effort; in-memory draft is enough for the current session.
        }
      }

      function saveScenarioAgentDraft(draft) {
        scenarioAgentDraft = draft;

        try {
          sessionStorage.setItem(scenarioAgentDraftStorageKey, JSON.stringify(draft));
        } catch {
          // Ignore storage failures; the in-memory draft still works until the plugin reloads.
        }
      }

      function isScenarioDraftRelatedContent(draft, content) {
        const original = normalizeScenarioDraftPrompt(draft?.promptMain).replace(/[^\p{L}\p{N}]+/gu, "");
        const current = normalizeScenarioDraftPrompt(content).replace(/[^\p{L}\p{N}]+/gu, "");

        if (!original || !current) {
          return false;
        }

        if (original === current || original.includes(current) || current.includes(original)) {
          return true;
        }

        const bigrams = (value) => Array.from(
          { length: Math.max(0, value.length - 1) },
          (_, index) => value.slice(index, index + 2),
        );
        const originalBigrams = bigrams(original);
        const currentCounts = new Map();
        for (const pair of bigrams(current)) {
          currentCounts.set(pair, (currentCounts.get(pair) || 0) + 1);
        }
        let overlap = 0;
        for (const pair of originalBigrams) {
          const count = currentCounts.get(pair) || 0;
          if (count > 0) {
            overlap += 1;
            currentCounts.set(pair, count - 1);
          }
        }
        const denominator = originalBigrams.length + Math.max(0, current.length - 1);
        return denominator > 0 && (2 * overlap) / denominator >= 0.45;
      }

      function getScenarioAgentDraftForContent(content) {
        const normalizedContent = normalizeScenarioDraftPrompt(content);

        if (scenarioAgentDraft && isScenarioDraftRelatedContent(scenarioAgentDraft, content)) {
          return scenarioAgentDraft;
        }

        if (scenarioAgentDraft && normalizeScenarioDraftPrompt(scenarioAgentDraft.promptMain) === normalizedContent) {
          return scenarioAgentDraft;
        }

        try {
          const stored = JSON.parse(sessionStorage.getItem(scenarioAgentDraftStorageKey) || "null");

          if (stored && isScenarioDraftRelatedContent(stored, content)) {
            scenarioAgentDraft = stored;
            return stored;
          }
        } catch {
          try {
            sessionStorage.removeItem(scenarioAgentDraftStorageKey);
          } catch {
            // Ignore storage cleanup failures.
          }
        }

        return null;
      }

      function getPreferredAspectRatioForScenarioAgent(agent, prompt) {
        const text = `${agent?.trigger || ""}\n${agent?.name || ""}\n${prompt || ""}`;

        if (/单体舞台|4\s*:\s*3/.test(text)) {
          return "4:3";
        }

        if (/微缩世界|3\s*:\s*4/.test(text)) {
          return "3:4";
        }

        return "";
      }

      function shouldMergeScenarioAgentWithStyle(value) {
        return value?.mergeWithStyleConfig === true;
      }

      function clearOperationScenarioForSemanticPlanning() {
        selectedOperationScenarioId = "";
      }

      function buildDirectPromptFromScenarioDraft(content) {
        const draft = getScenarioAgentDraftForContent(content);

        if (!draft || shouldMergeScenarioAgentWithStyle(draft)) {
          return undefined;
        }

        return {
          positive: [draft.promptFixedPositive, content].filter(Boolean).join("\n\n"),
          negative: draft.promptNegative || "",
          template: "flat_to_3d",
          referencePack: {
            inputAssetId: selectedAssets[0]?.id || "text-only",
            stylePresetId: "",
            styleAnchors: [],
          },
        };
      }

      function getSlashContext() {
        const cursor = messageInput.selectionStart || 0;
        const beforeCursor = messageInput.value.slice(0, cursor);
        const match = beforeCursor.match(/(^|\s)\/([^\s/]*)$/);

        if (!match) {
          return undefined;
        }

        const query = match[2];
        return {
          query,
          start: cursor - query.length - 1,
          end: cursor,
        };
      }

      function getMentionContext() {
        const cursor = messageInput.selectionStart || 0;
        const beforeCursor = messageInput.value.slice(0, cursor);
        const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);

        if (!match) {
          return undefined;
        }

        const query = match[2];
        return {
          query,
          start: cursor - query.length - 1,
          end: cursor,
        };
      }

      function hideScenarioPanel() {
        scenarioPanel.classList.remove("open");
        scenarioPanel.innerHTML = "";
        activeScenarioSuggestions = [];
      }

      function buildScenarioText(scenario) {
        return scenario.variablePrompt || scenario.content || "";
      }

      function insertScenarioAgentTrigger(agent) {
        const context = getSlashContext();
        const value = messageInput.value;
        const insertText = `${agent.trigger} `;
        if (!shouldMergeScenarioAgentWithStyle(agent)) {
          clearStyleSelectionsForScenarioAgent();
        } else {
          clearScenarioAgentDraft();
          clearOperationScenarioForSemanticPlanning();
        }

        if (!context) {
          messageInput.value = value ? `${value}\n${insertText}` : insertText;
          messageInput.focus();
          messageInput.selectionStart = messageInput.selectionEnd = messageInput.value.length;
          hideScenarioPanel();
          resizeMessageInput();
          selectionStatus.textContent = shouldMergeScenarioAgentWithStyle(agent)
            ? "已选择语义规划 Skill，将保留当前品牌预设和自由搭配。"
            : "已选择场景智能体，请继续输入主题后点击“生成Prompt”。";
          updateRunState();
          return;
        }

        const prefix = value.slice(0, context.start);
        const suffix = value.slice(context.end);
        const needsSpace = suffix && !/^\s/.test(suffix) ? " " : "";
        messageInput.value = `${prefix}${insertText}${needsSpace}${suffix}`;
        const cursor = prefix.length + insertText.length;
        messageInput.focus();
        messageInput.selectionStart = messageInput.selectionEnd = cursor;
        hideScenarioPanel();
        resizeMessageInput();
        selectionStatus.textContent = shouldMergeScenarioAgentWithStyle(agent)
          ? "已选择语义规划 Skill，将保留当前品牌预设和自由搭配。"
          : "已选择场景智能体，请继续输入主题后点击“生成Prompt”。";
        updateRunState();
      }

      function insertScenarioContent(scenario) {
        const context = getMentionContext();
        const value = messageInput.value;
        const insertText = buildScenarioText(scenario);
        selectedOperationScenarioId = scenario.id || "";

        if (!context) {
          messageInput.value = value ? `${value}\n${insertText}` : insertText;
          messageInput.focus();
          messageInput.selectionStart = messageInput.selectionEnd = messageInput.value.length;
          hideScenarioPanel();
          resizeMessageInput();
          updateRunState();
          return;
        }

        const prefix = value.slice(0, context.start);
        const suffix = value.slice(context.end);
        const needsSpace = suffix && !/^\s/.test(suffix) ? " " : "";
        messageInput.value = `${prefix}${insertText}${needsSpace}${suffix}`;
        const cursor = prefix.length + insertText.length + needsSpace.length;
        messageInput.focus();
        messageInput.selectionStart = messageInput.selectionEnd = cursor;
        hideScenarioPanel();
        resizeMessageInput();
        updateRunState();
      }

      function insertActiveScenarioSuggestion(suggestion) {
        if (suggestion.type === "scenario-agent") {
          insertScenarioAgentTrigger(suggestion.agent);
          return;
        }

        insertScenarioContent(suggestion.scenario);
      }

      function renderScenarioSuggestions() {
        const slashContext = getSlashContext();
        if (slashContext) {
          const query = slashContext.query.trim().toLowerCase();
          activeScenarioSuggestions = scenarioAgents
            .filter((agent) => agent.enabled !== false)
            .filter((agent) => !query || agent.name.toLowerCase().includes(query) || agent.trigger.toLowerCase().includes(query))
            .slice(0, 8)
            .map((agent) => ({ type: "scenario-agent", agent }));

          scenarioPanel.innerHTML = "";

          if (!activeScenarioSuggestions.length) {
            hideScenarioPanel();
            return;
          }

          for (const [index, suggestion] of activeScenarioSuggestions.entries()) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `scenario-option${index === 0 ? " active" : ""}`;
            button.innerHTML = `<strong></strong><span></span>`;
            button.querySelector("strong").textContent = suggestion.agent.trigger;
            button.querySelector("span").textContent = suggestion.agent.description;
            button.addEventListener("click", () => insertActiveScenarioSuggestion(suggestion));
            scenarioPanel.appendChild(button);
          }

          scenarioPanel.classList.add("open");
          return;
        }

        const context = getMentionContext();

        if (!context) {
          hideScenarioPanel();
          return;
        }

        const query = context.query.trim().toLowerCase();
        activeScenarioSuggestions = operationScenarios
          .filter((scenario) => !query || scenario.name.toLowerCase().includes(query))
          .slice(0, 8)
          .map((scenario) => ({ type: "operation-scenario", scenario }));

        scenarioPanel.innerHTML = "";

        if (!activeScenarioSuggestions.length) {
          hideScenarioPanel();
          return;
        }

        for (const [index, suggestion] of activeScenarioSuggestions.entries()) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `scenario-option${index === 0 ? " active" : ""}`;
          button.innerHTML = `<strong></strong><span></span>`;
          button.querySelector("strong").textContent = `@${suggestion.scenario.name}`;
          button.querySelector("span").textContent = suggestion.scenario.description || buildScenarioText(suggestion.scenario).slice(0, 36);
          button.addEventListener("click", () => insertActiveScenarioSuggestion(suggestion));
          scenarioPanel.appendChild(button);
        }

        scenarioPanel.classList.add("open");
      }

      function appendDebugSection(parent, title, content) {
        const section = document.createElement("section");
        const heading = document.createElement("strong");
        const body = document.createElement("pre");

        section.className = "debug-section";
        heading.textContent = title;
        body.textContent = content || "无";
        section.append(heading, body);
        parent.appendChild(section);
      }

      function buildReferenceDebugText(task) {
        const candidates = task.referenceAssets?.length ? task.referenceAssets : task.inputAsset ? [task.inputAsset] : [];
        const references = candidates.filter((asset) => asset.mimeType?.startsWith("image/"));

        if (!references.length) {
          return "无参考图";
        }

        return references.map((asset, index) => {
          const label = asset.referenceLabel || `图${index + 1}`;
          const size = asset.width && asset.height ? ` · ${asset.width}x${asset.height}` : "";
          return `${label}：${asset.filename || asset.name || asset.id}${size}`;
        }).join("\n");
      }

      function getHighestReferencedImageIndex(content) {
        const matches = [...content.matchAll(/图\s*(\d+)/g)];

        return matches.reduce((max, match) => Math.max(max, Number(match[1]) || 0), 0);
      }

      function createPromptDebugPanel(task) {
        const panel = document.createElement("details");
        const copyButton = document.createElement("button");
        const debugText = [
          `参考图编号：\n${buildReferenceDebugText(task)}`,
          `语言模型最终正向 Prompt：\n${task.prompt?.positive || "无"}`,
          `语言模型最终负向 Prompt：\n${task.prompt?.negative || "无"}`,
          `输出设置：\n比例：${task.constraints?.aspectRatio || "未知"}\n分辨率：${task.constraints?.resolution || "未知"}\n请求张数：${task.constraints?.batchSize || "未知"}`,
        ].join("\n\n");

        panel.className = "debug-panel";
        panel.innerHTML = "<summary>调试信息：查看最终 Prompt 和图1/图2对应关系</summary>";
        copyButton.className = "debug-copy-button";
        copyButton.type = "button";
        copyButton.textContent = "复制调试信息";
        copyButton.addEventListener("click", () => {
          messageInput.value = debugText;
          selectedOperationScenarioId = "";
          messageInput.focus();
          resizeMessageInput();
          updateRunState();
        });
        panel.appendChild(copyButton);
        appendDebugSection(panel, "参考图编号", buildReferenceDebugText(task));
        appendDebugSection(panel, "语言模型最终正向 Prompt", task.prompt?.positive);
        appendDebugSection(panel, "语言模型最终负向 Prompt", task.prompt?.negative);
        appendDebugSection(panel, "输出设置", [
          `比例：${task.constraints?.aspectRatio || "未知"}`,
          `分辨率：${task.constraints?.resolution || "未知"}`,
          `请求张数：${task.constraints?.batchSize || "未知"}`,
        ].join("\n"));

        return panel;
      }

