import {
  $, TOKEN_KEY, addMessage, api, checkHealth, clearSession, elements, fileToAsset, generate,
  loadConfig, refreshSession, renderAttachments, renderMember, renderTasks,
  resetWorkspace, responseJson, saveSettings, showLogin, state, toast,
  updateGenerateState,
} from "./app.js";
import { createHistoryController } from "./history.js";

const history = createHistoryController({
  api, responseJson, elements, state, resetWorkspace, addMessage, toast,
});
state.renderHistory = history.render;
state.refreshHistory = history.load;

elements.loginDialog.addEventListener("cancel", (event) => {
  if (!state.token) event.preventDefault();
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginButton.disabled = true;
  elements.loginError.textContent = "";
  try {
    const data = await responseJson(await api("/api/member/session/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: elements.inviteInput.value.trim() }),
    }, true), "登录失败");
    state.token = data.sessionToken;
    state.session = data.session;
    localStorage.setItem(TOKEN_KEY, state.token);
    renderMember();
    elements.loginDialog.close();
    try {
      await loadConfig();
      await history.load();
      updateGenerateState();
    } catch (error) {
      elements.generate.disabled = true;
      toast(`${error.message}，请刷新页面重试。`);
    }
  } catch (error) {
    elements.loginError.textContent = error.message;
  } finally {
    elements.loginButton.disabled = false;
  }
});

elements.logout.addEventListener("click", () => {
  if (!confirm("退出只会清除本浏览器的登录信息。确定退出吗？")) return;
  clearSession();
  showLogin();
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = elements.prompt.value.trim();
  if (!content && !state.assets.length) return;
  elements.prompt.value = "";
  generate(content || "请根据参考图生成统一品牌风格的视觉");
});

elements.files.addEventListener("change", async () => {
  const available = 4 - state.assets.length;
  const files = [...elements.files.files].slice(0, available);
  if (files.some((file) => !file.type.startsWith("image/") || file.size > 10 * 1024 * 1024)) {
    toast("只支持 10MB 以内的图片文件");
    elements.files.value = "";
    return;
  }
  try {
    const added = await Promise.all(
      files.map((file, index) => fileToAsset(file, state.assets.length + index)),
    );
    state.assets.push(...added);
    renderAttachments();
  } catch (error) {
    toast(error.message);
  }
  elements.files.value = "";
});

document.addEventListener("change", (event) => {
  if (event.target.closest(".settings-panel")) saveSettings();
});

document.addEventListener("click", (event) => {
  const suggestion = event.target.closest("[data-prompt]");
  if (suggestion) {
    elements.prompt.value = suggestion.dataset.prompt;
    elements.prompt.focus();
  }
});

function closePanels() {
  elements.sidebar.classList.remove("open");
  elements.settings.classList.remove("open");
  document.body.classList.remove("panel-open");
}

$("#new-chat-button").addEventListener("click", () => {
  resetWorkspace();
  closePanels();
});
$("#menu-button").addEventListener("click", () => {
  elements.sidebar.classList.add("open");
  document.body.classList.add("panel-open");
});
$("#settings-toggle").addEventListener("click", () => {
  elements.settings.classList.add("open");
  document.body.classList.add("panel-open");
});
$("#settings-close").addEventListener("click", closePanels);
$("#mobile-scrim").addEventListener("click", closePanels);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePanels();
});

async function bootstrap() {
  checkHealth();
  renderTasks();
  if (!state.token) return showLogin();
  try {
    await refreshSession();
    await loadConfig();
    await history.load();
    updateGenerateState();
  } catch (error) {
    if (!state.token) showLogin(error.message);
    else toast(`${error.message}，请刷新页面重试。`);
  }
}

bootstrap();
