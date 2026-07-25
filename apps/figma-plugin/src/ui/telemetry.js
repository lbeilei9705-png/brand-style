      const telemetrySessionStorageKey = "brand-style-client-session-id";
      const telemetryEndpoint = "/api/telemetry/events";
      const telemetryBreadcrumbLimit = 80;
      const telemetryQueueLimit = 12;
      const telemetryFlushDelay = 4000;
      const sensitiveTelemetryKey = /^(token|authorization|cookie|prompt|content|message|base64|dataurl|imageurl|assetdata|invite(code)?|api[-_]?key|secret)$/i;
      let telemetryQueue = [];
      let telemetryBreadcrumbs = [];
      let telemetryFlushTimer = null;

      function createTelemetryId(prefix = "") {
        const uuid = globalThis.crypto?.randomUUID?.()
          || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        return `${prefix}${uuid}`;
      }

      function getClientSessionId() {
        let id = "";
        try {
          id = localStorage.getItem(telemetrySessionStorageKey) || "";
          if (!id) {
            id = createTelemetryId();
            localStorage.setItem(telemetrySessionStorageKey, id);
          }
        } catch {
          id = createTelemetryId();
        }
        return id;
      }

      const clientSessionId = getClientSessionId();

      function sanitizeTelemetryValue(value, depth = 0) {
        if (depth > 4 || value == null || typeof value === "boolean" || typeof value === "number") {
          return value;
        }
        if (typeof value === "string") {
          if (/^data:/i.test(value) || /^bearer\s/i.test(value)) {
            return "[REDACTED]";
          }
          if (/^https?:\/\//i.test(value)) {
            try {
              const url = new URL(value);
              for (const key of [...url.searchParams.keys()]) {
                if (/^(token|key|signature|sig|expires|credential)$/i.test(key)) {
                  url.searchParams.set(key, "[REDACTED]");
                }
              }
              return url.toString().slice(0, 240);
            } catch {
              return value.slice(0, 240);
            }
          }
          return value.length > 240 ? `${value.slice(0, 240)}…` : value;
        }
        if (Array.isArray(value)) {
          return value.slice(0, 20).map((item) => sanitizeTelemetryValue(item, depth + 1));
        }
        if (typeof value !== "object") {
          return String(value);
        }
        const safe = {};
        for (const [key, item] of Object.entries(value)) {
          if (!sensitiveTelemetryKey.test(key) && item !== undefined) {
            safe[key] = sanitizeTelemetryValue(item, depth + 1);
          }
        }
        return safe;
      }

      function addBreadcrumb(name, metadata = {}) {
        telemetryBreadcrumbs.push({
          at: new Date().toISOString(),
          name,
          metadata: sanitizeTelemetryValue(metadata),
        });
        telemetryBreadcrumbs = telemetryBreadcrumbs.slice(-telemetryBreadcrumbLimit);
      }

      function scheduleTelemetryFlush() {
        if (telemetryFlushTimer) {
          return;
        }
        telemetryFlushTimer = window.setTimeout(() => {
          telemetryFlushTimer = null;
          flushTelemetry();
        }, telemetryFlushDelay);
      }

      function trackEvent(name, metadata = {}) {
        const event = {
          eventId: createTelemetryId("evt_"),
          clientSessionId,
          at: new Date().toISOString(),
          name,
          metadata: sanitizeTelemetryValue(metadata),
        };
        addBreadcrumb(name, event.metadata);
        telemetryQueue.push(event);
        if (telemetryQueue.length >= telemetryQueueLimit) {
          flushTelemetry();
        } else {
          scheduleTelemetryFlush();
        }
        return event;
      }

      function flushTelemetry() {
        if (!telemetryQueue.length) {
          return;
        }
        const events = telemetryQueue.splice(0, telemetryQueueLimit);
        const body = JSON.stringify({ clientSessionId, events });
        fetch(`${apiBase}${telemetryEndpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-client-session-id": clientSessionId,
            ...(memberSessionToken ? { Authorization: `Bearer ${memberSessionToken}` } : {}),
          },
          body,
          keepalive: true,
        }).then((response) => {
          if (!response.ok) {
            throw new Error(`Telemetry HTTP ${response.status}`);
          }
        }).catch(() => {
          telemetryQueue = [...events, ...telemetryQueue].slice(0, telemetryQueueLimit * 4);
          scheduleTelemetryFlush();
        });
        if (telemetryQueue.length) {
          scheduleTelemetryFlush();
        }
      }

      function ensureIssueId(error) {
        if (error && typeof error === "object") {
          if (!error.issueId) {
            error.issueId = createTelemetryId("issue_");
          }
          return error.issueId;
        }
        return createTelemetryId("issue_");
      }

      function recordClientError(error, context = {}) {
        const issueId = ensureIssueId(error);
        trackEvent("client_error", {
          ...context,
          issueId,
          requestId: error?.requestId,
          errorName: error?.name,
        });
        return issueId;
      }

      function createApiError(response, data, fallbackMessage) {
        const error = new Error(data?.error || fallbackMessage);
        error.requestId = response?.requestId || response?.headers?.get("x-request-id") || undefined;
        error.issueId = data?.issueId || response?.issueId || response?.headers?.get("x-issue-id") || undefined;
        error.status = response?.status;
        ensureIssueId(error);
        return error;
      }

      function getRecentDiagnosticMessages() {
        return [...chat.querySelectorAll(".message")].slice(-12).map((node) => ({
          role: node.classList.contains("user") ? "user" : node.classList.contains("assistant") ? "assistant" : "system",
          text: (node.querySelector(".message-content")?.textContent || node.textContent || "").slice(0, 2000),
        }));
      }

      function buildDiagnosticBundle(includeText = false) {
        const bundle = {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          clientSessionId,
          environment: {
            userAgent: navigator.userAgent,
            language: navigator.language,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          },
          state: {
            authenticated: Boolean(memberSession),
            conversationActive: Boolean(activeConversationId),
            selectionCount: selectedAssets.length,
            isSending,
            modelId: modelSelect.value,
            agentId: agentSelect.value,
          },
          breadcrumbs: telemetryBreadcrumbs,
        };
        if (includeText) {
          bundle.recentMessages = getRecentDiagnosticMessages();
          bundle.currentPrompt = messageInput.value;
        }
        return bundle;
      }

      function saveDiagnosticJson(json, suffix = "") {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `brand-style-diagnostics${suffix}-${Date.now()}.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      async function downloadDiagnosticBundle(includeText = false) {
        const clientContext = buildDiagnosticBundle(includeText);
        try {
          const response = await apiFetch("/api/diagnostics/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientSessionId, clientContext }),
          });
          if (!response.ok) {
            throw createApiError(response, await response.json().catch(() => ({})), "导出诊断包失败");
          }
          const result = await response.json();
          saveDiagnosticJson(result.content || JSON.stringify(result.bundle || result, null, 2));
        } catch (error) {
          saveDiagnosticJson(JSON.stringify(clientContext, null, 2), "-local");
          recordClientError(error, { operation: "diagnostics_export", localFallback: true });
        }
        trackEvent("diagnostics_export", { includeText, includesImages: false, includesToken: false });
      }

      async function copyDiagnosticInfo(issueId = "") {
        const text = JSON.stringify({
          issueId: issueId || undefined,
          clientSessionId,
          breadcrumbs: telemetryBreadcrumbs.slice(-20),
        }, null, 2);
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const input = document.createElement("textarea");
          input.value = text;
          document.body.appendChild(input);
          input.select();
          document.execCommand("copy");
          input.remove();
        }
        trackEvent("diagnostics_copy", { issueId: issueId || undefined });
      }

      window.addEventListener("pagehide", flushTelemetry);
