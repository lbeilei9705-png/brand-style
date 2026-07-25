      async function apiFetch(path, options = {}) {
        const headers = {
          ...(options.headers || {}),
        };

        if (memberSessionToken) {
          headers.Authorization = `Bearer ${memberSessionToken}`;
        }

        const response = await fetch(`${apiBase}${path}`, {
          ...options,
          headers,
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

