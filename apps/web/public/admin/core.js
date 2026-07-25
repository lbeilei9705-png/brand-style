export const state = {
  models: [],
  agents: [],
  materials: [],
  colorPalettes: [],
  shapeArchitectures: [],
  operationScenarios: [],
  scenarioAgents: [],
  scenarioAgentCases: [],
  memberInvites: [],
  members: [],
};

const accessTokenStorageKey = "brand-style-admin-token";
let accessTokenPromptPromise;

export function qs(selector) {
  return document.querySelector(selector);
}

function promptForAccessToken() {
  if (accessTokenPromptPromise) {
    return accessTokenPromptPromise;
  }

  const promptPromise = new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "admin-token-backdrop";
    backdrop.innerHTML = `
      <form class="admin-token-card">
        <div>
          <h2>后台访问验证</h2>
          <p>请输入后台访问 token 后继续管理配置。</p>
        </div>
        <label class="admin-field">
          <span>访问 Token</span>
          <input id="admin-token-input" type="password" autocomplete="current-password" required />
        </label>
        <div class="admin-token-actions">
          <button class="primary-button" type="submit">确定</button>
        </div>
      </form>
    `;
    const form = backdrop.querySelector("form");
    const input = backdrop.querySelector("#admin-token-input");
    const cleanup = (token) => {
      backdrop.remove();
      resolve(token);
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const token = input.value.trim();

      if (!token) {
        input.focus();
        return;
      }

      localStorage.setItem(accessTokenStorageKey, token);
      cleanup(token);
    });
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => input.focus());
  });

  accessTokenPromptPromise = promptPromise.finally(() => {
    accessTokenPromptPromise = undefined;
  });

  return accessTokenPromptPromise;
}

async function getAccessToken() {
  const savedToken = localStorage.getItem(accessTokenStorageKey);

  if (savedToken) {
    return savedToken;
  }

  return promptForAccessToken();
}

export async function requestJson(url, options = {}, hasRetried = false) {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new Error("需要后台访问 token 才能读取配置。");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "x-brand-style-token": accessToken,
    },
  });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(accessTokenStorageKey);

      if (!hasRetried) {
        return requestJson(url, options, true);
      }
    }

    throw new Error(data.error || "请求失败");
  }

  return data;
}

export async function uploadAsset(file, category) {
  const formData = new FormData();
  formData.append("category", category);
  formData.append("asset", file);
  const data = await requestJson("/api/assets", {
    method: "POST",
    body: formData,
  });

  return data.asset?.url || "";
}

export function boolValue(value) {
  return value === true || value === "true";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function openModal(id) {
  qs(`#${id}`).classList.add("open");
}

export function closeModals() {
  for (const modal of document.querySelectorAll(".modal-backdrop")) {
    modal.classList.remove("open");
  }
}

export function renderStatus(enabled) {
  return `<span class="pill${enabled ? "" : " off"}">${enabled ? "已启用" : "已停用"}</span>`;
}

export function safeImageUrl(value) {
  const url = String(value || "").trim();
  return /^(https?:|data:image\/|blob:|\/)/i.test(url) ? url : "";
}
