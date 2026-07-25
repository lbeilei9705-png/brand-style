      async function apiFetch(path, options = {}) {
        const clientRequestId = createTelemetryId("req_");
        const headers = {
          ...(options.headers || {}),
          "x-client-session-id": clientSessionId,
          "x-client-request-id": clientRequestId,
        };

        if (memberSessionToken && !options.skipAuth) {
          headers.Authorization = `Bearer ${memberSessionToken}`;
        }

        const startedAt = Date.now();
        addBreadcrumb("api_request", { path, method: options.method || "GET", clientRequestId });
        let response;
        try {
          const { skipAuth, ...fetchOptions } = options;
          response = await fetch(`${apiBase}${path}`, {
            ...fetchOptions,
            headers,
          });
        } catch (error) {
          error.requestId = clientRequestId;
          recordClientError(error, { operation: "api_fetch", path, clientRequestId });
          throw error;
        }

        response.requestId = response.headers.get("x-request-id") || clientRequestId;
        response.issueId = response.headers.get("x-issue-id") || undefined;
        addBreadcrumb("api_response", {
          path,
          status: response.status,
          requestId: response.requestId,
          durationMs: Date.now() - startedAt,
        });

        if (response.status === 401 && path !== "/api/member/session/redeem") {
          clearMemberSession();
          showMemberLogin("登录已失效，请重新输入邀请码。");
        }

        return response;
      }

      function renderMemberSession() {
        if (!memberSession) {
          memberSessionSummary.hidden = true;
          memberSessionLabel.textContent = "";
          return;
        }

        memberSessionSummary.hidden = false;
        memberSessionLabel.textContent = `${memberSession.memberName} · 今日剩余 ${memberSession.remainingToday}/${memberSession.dailyLimit}`;
      }

      function saveMemberSession(token, session) {
        memberSessionToken = token;
        memberSession = session;
        localStorage.setItem(memberSessionStorageKey, token);
        renderMemberSession();
      }

      function clearMemberSession() {
        memberSessionToken = "";
        memberSession = null;
        activeConversationId = null;
        localStorage.removeItem(memberSessionStorageKey);
        renderMemberSession();
        updateRunState();
      }

      function showMemberLogin(message = "") {
        memberLoginStatus.textContent = message;
        memberLoginOverlay.hidden = false;
        window.setTimeout(() => memberInviteCodeInput.focus(), 0);
      }

      function hideMemberLogin() {
        memberLoginOverlay.hidden = true;
        memberLoginStatus.textContent = "";
        memberInviteCodeInput.value = "";
      }

      async function initializeMemberSession() {
        if (!memberSessionToken) {
          showMemberLogin();
          return false;
        }

        const response = await apiFetch("/api/member/session/me");

        if (!response.ok) {
          showMemberLogin("登录已失效，请重新输入邀请码。");
          return false;
        }

        const data = await response.json();
        memberSession = data.session;
        renderMemberSession();
        hideMemberLogin();
        return true;
      }

      async function refreshMemberSession() {
        if (!memberSessionToken) {
          return;
        }

        const response = await apiFetch("/api/member/session/me");

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        memberSession = data.session;
        renderMemberSession();
      }

