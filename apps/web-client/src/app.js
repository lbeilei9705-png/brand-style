import { downloadResult, fileToAsset, imageUrlToAsset } from "./assets.js";

const $ = (selector) => document.querySelector(selector);
const TOKEN_KEY = "brand-style-web-member-token";
const SETTINGS_KEY = "brand-style-web-settings";
const CLIENT_SESSION_KEY = "brand-style-web-client-session";
const tokenFromStorage = () => localStorage.getItem(TOKEN_KEY) || "";
const clientSessionId = localStorage.getItem(CLIENT_SESSION_KEY) || crypto.randomUUID();
localStorage.setItem(CLIENT_SESSION_KEY, clientSessionId);

const elements = {
  loginDialog: $("#login-dialog"),
  loginForm: $("#login-form"),
  loginButton: $("#login-button"),
  loginError: $("#login-error"),
  inviteInput: $("#invite-input"),
  logout: $("#logout-button"),
  memberName: $("#member-name"),
  memberQuota: $("#member-quota"),
  memberAvatar: $("#member-avatar"),
  serviceStatus: $("#service-status"),
  form: $("#composer-form"),
  prompt: $("#prompt-input"),
  generate: $("#generate-button"),
  files: $("#file-input"),
  attachments: $("#attachments"),
  empty: $("#empty-state"),
  feed: $("#feed"),
  resultsSection: $("#results-section"),
  results: $("#result-grid"),
  resultSummary: $("#result-summary"),
  taskList: $("#task-list"),
  taskCount: $("#task-count"),
  model: $("#model-select"),
  style: $("#style-select"),
  skill: $("#skill-select"),
  palette: $("#palette-select"),
  shape: $("#shape-select"),
  materials: $("#material-list"),
  ratio: $("#ratio-select"),
  resolution: $("#resolution-select"),
  batch: $("#batch-select"),
  sidebar: $(".sidebar"),
  settings: $("#settings-panel"),
};

const state = {
  token: tokenFromStorage(),
  session: null,
  conversationId: null,
  assets: [],
  tasks: [],
  workspaceId: 0,
  config: { models: [], styles: [], skills: [], materials: [], palettes: [], shapes: [] },
  activeRequests: new Map(),
};

function createRequestId() {
  return `web_${crypto.randomUUID()}`;
}

async function api(path, options = {}, allowAnonymous = false) {
  const headers = new Headers(options.headers || {});
  headers.set("x-client-session-id", clientSessionId);
  headers.set("x-client-request-id", createRequestId());
  headers.set("x-client-version", "web-mvp-1");
  if (state.token && !allowAnonymous) headers.set("Authorization", `Bearer ${state.token}`);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && !allowAnonymous) {
    clearSession();
    showLogin("登录已失效，请使用新的邀请码重新登录。");
  }
  return response;
}

async function responseJson(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `${fallback}（HTTP ${response.status}）`);
    error.code = data.code;
    throw error;
  }
  return data;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 3200);
}

function showLogin(message = "") {
  elements.loginError.textContent = message;
  if (!elements.loginDialog.open) elements.loginDialog.showModal();
  window.setTimeout(() => elements.inviteInput.focus(), 0);
}

function clearSession() {
  for (const controller of state.activeRequests.values()) controller.abort();
  state.activeRequests.clear();
  state.token = "";
  state.session = null;
  state.tasks = [];
  localStorage.removeItem(TOKEN_KEY);
  resetWorkspace();
  renderTasks();
  renderMember();
}

function renderMember() {
  const session = state.session;
  elements.memberName.textContent = session?.memberName || "未登录";
  elements.memberQuota.textContent = session
    ? `今日剩余 ${session.remainingToday}/${session.dailyLimit}`
    : "输入邀请码开始";
  elements.memberAvatar.textContent = (session?.memberName || "B").trim().slice(0, 1).toUpperCase();
}

async function refreshSession() {
  const data = await responseJson(await api("/api/member/session/me"), "读取成员信息失败");
  state.session = data.session;
  renderMember();
}

function appendOptions(select, items, getLabel = (item) => item.name) {
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = getLabel(item);
    select.appendChild(option);
  }
}

function loadSavedSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
  }
  for (const [name, element] of Object.entries({
    modelId: elements.model,
    styleId: elements.style,
    skillId: elements.skill,
    paletteId: elements.palette,
    shapeId: elements.shape,
    ratio: elements.ratio,
    resolution: elements.resolution,
    batch: elements.batch,
  })) {
    if (saved[name] && [...element.options].some((option) => option.value === saved[name])) {
      element.value = saved[name];
    }
  }
  for (const input of elements.materials.querySelectorAll("input")) {
    input.checked = (saved.materialIds || []).includes(input.value);
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    modelId: elements.model.value,
    styleId: elements.style.value,
    skillId: elements.skill.value,
    paletteId: elements.palette.value,
    shapeId: elements.shape.value,
    ratio: elements.ratio.value,
    resolution: elements.resolution.value,
    batch: elements.batch.value,
    materialIds: [...elements.materials.querySelectorAll("input:checked")].map((input) => input.value),
  }));
}

async function loadConfig() {
  const paths = [
    "/api/config/models", "/api/config/style-skills", "/api/config/scenario-agents",
    "/api/config/materials", "/api/config/color-palettes", "/api/config/shape-architectures",
  ];
  const responses = await Promise.all(paths.map((path) => api(path)));
  const payloads = await Promise.all(responses.map((response) => responseJson(response, "加载生成配置失败")));
  state.config.models = (payloads[0].models || []).filter((item) => item.enabled && (item.purpose || "image") === "image");
  state.config.styles = (payloads[1].styleSkills || payloads[1].agents || []).filter((item) => item.enabled);
  state.config.skills = (payloads[2].scenarioAgents || []).filter((item) => item.enabled !== false);
  state.config.materials = (payloads[3].materials || []).filter((item) => item.enabled);
  state.config.palettes = (payloads[4].colorPalettes || []).filter((item) => item.enabled);
  state.config.shapes = (payloads[5].shapeArchitectures || []).filter((item) => item.enabled);
  elements.model.replaceChildren();
  for (const select of [elements.style, elements.skill, elements.palette, elements.shape]) {
    select.options.length = 1;
  }
  appendOptions(elements.model, state.config.models);
  appendOptions(elements.style, state.config.styles);
  appendOptions(elements.skill, state.config.skills, (item) => `${item.trigger} · ${item.name}`);
  appendOptions(elements.palette, state.config.palettes);
  appendOptions(elements.shape, state.config.shapes);
  elements.materials.replaceChildren();
  for (const material of state.config.materials) {
    const label = document.createElement("label");
    label.className = "material-chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = material.id;
    const text = document.createElement("span");
    text.textContent = material.name;
    label.append(input, text);
    elements.materials.append(label);
  }
  loadSavedSettings();
}

function setServiceStatus(kind, text) {
  elements.serviceStatus.className = `status-pill ${kind}`;
  elements.serviceStatus.lastChild.textContent = text;
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error();
    const health = await response.json();
    setServiceStatus(health.ready === false ? "error" : "ready", health.ready === false ? "服务未就绪" : "服务正常");
  } catch {
    setServiceStatus("error", "服务不可用");
  }
}

function renderAttachments() {
  elements.attachments.hidden = !state.assets.length;
  elements.attachments.replaceChildren();
  state.assets.forEach((asset, index) => {
    asset.referenceLabel = `图${index + 1}`;
    const item = document.createElement("div");
    item.className = "attachment";
    const image = document.createElement("img");
    image.src = asset.assetDataUrl;
    image.alt = `${asset.referenceLabel}：${asset.name}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `删除${asset.referenceLabel}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.assets = state.assets.filter((entry) => entry.id !== asset.id);
      renderAttachments();
    });
    item.append(image, remove);
    elements.attachments.append(item);
  });
}

function addMessage(kind, content, pending = false) {
  elements.empty.hidden = true;
  const message = document.createElement("div");
  message.className = `message ${kind}`;
  if (pending) {
    const line = document.createElement("span");
    line.className = "progress-line";
    const spinner = document.createElement("i");
    spinner.className = "spinner";
    const text = document.createElement("span");
    text.textContent = content;
    line.append(spinner, text);
    message.append(line);
  } else {
    message.textContent = content;
  }
  elements.feed.append(message);
  message.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return message;
}

function renderTasks() {
  elements.taskCount.textContent = String(state.tasks.length);
  elements.taskList.replaceChildren();
  if (!state.tasks.length) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    empty.textContent = "生成任务会显示在这里";
    elements.taskList.append(empty);
    return;
  }
  for (const task of state.tasks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `task-item ${task.status}`;
    const dot = document.createElement("i");
    const label = document.createElement("span");
    label.textContent = task.prompt || "图片生成任务";
    button.append(dot, label);
    button.addEventListener("click", () => task.anchor?.scrollIntoView({ behavior: "smooth", block: "center" }));
    elements.taskList.prepend(button);
  }
}

function renderResults(task, prompt, anchor) {
  elements.resultsSection.hidden = false;
  elements.resultSummary.textContent = `${task.results.length} 张 · ${task.constraints?.resolution || elements.resolution.value}`;
  for (const result of task.results) {
    const card = document.createElement("article");
    card.className = "result-card";
    const image = document.createElement("img");
    image.src = result.imageUrl;
    image.alt = `${prompt}，候选图片 ${result.rank}`;
    image.loading = "lazy";
    const meta = document.createElement("div");
    meta.className = "result-meta";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `图片 ${result.rank}`;
    const size = document.createElement("span");
    size.textContent = result.width && result.height ? `${result.width} × ${result.height}` : "原始尺寸";
    info.append(title, size);
    const actions = document.createElement("div");
    actions.className = "result-actions";
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "下载";
    download.addEventListener("click", async () => {
      download.disabled = true;
      try {
        await downloadResult(task, result);
      } catch (error) {
        toast(error.message);
      } finally {
        download.disabled = false;
      }
    });
    const reference = document.createElement("button");
    reference.type = "button";
    reference.textContent = "作参考";
    reference.addEventListener("click", async () => {
      if (state.assets.length >= 4) return toast("参考图最多添加 4 张");
      reference.disabled = true;
      try {
        state.assets.push(await imageUrlToAsset(result, state.assets.length));
        renderAttachments();
        toast("已添加为参考图");
      } catch (error) {
        toast(error.message);
      } finally {
        reference.disabled = false;
      }
    });
    actions.append(download, reference);
    meta.append(info, actions);
    card.append(image, meta);
    elements.results.prepend(card);
  }
  anchor.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function ensureConversation(snapshot, workspaceId) {
  if (state.conversationId && workspaceId === state.workspaceId) return state.conversationId;
  const response = await api("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: snapshot.modelId, agentId: snapshot.agentId }),
  });
  const data = await responseJson(response, "创建对话失败");
  if (workspaceId === state.workspaceId) state.conversationId = data.conversation.id;
  return data.conversation.id;
}

async function completeSkill(skill, content, selectionAssets, signal) {
  const requestContent = content.startsWith(skill.trigger) ? content : `${skill.trigger} ${content}`;
  const response = await api("/api/scenario-agent/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: requestContent, selectionAssets }),
    signal,
  });
  return responseJson(response, `${skill.name} 规划失败`);
}

async function buildGenerationSnapshot(content, selectionAssets, signal) {
  const skill = state.config.skills.find((item) => item.id === elements.skill.value);
  const snapshot = {
    content,
    modelId: elements.model.value,
    agentId: elements.style.value,
    inputType: "auto",
    selectionAssets,
    batchSize: Number(elements.batch.value),
    aspectRatio: elements.ratio.value,
    resolution: elements.resolution.value,
    materialPresetIds: [...elements.materials.querySelectorAll("input:checked")].map((input) => input.value),
    colorPaletteId: elements.palette.value,
    shapeArchitectureId: elements.shape.value,
    usePromptOrchestrator: Boolean(
      elements.style.value
      || elements.palette.value
      || elements.shape.value
      || elements.materials.querySelector("input:checked"),
    ),
  };
  if (!skill) return snapshot;
  const completion = await completeSkill(skill, content, selectionAssets, signal);
  snapshot.content = completion.prompt;
  if (skill.mergeWithStyleConfig) {
    snapshot.semanticPlanId = skill.id;
    snapshot.semanticFixedPositivePrompt = completion.promptFixedPositive;
    snapshot.semanticNegativePrompt = completion.promptNegative;
    snapshot.usePromptOrchestrator = true;
  } else {
    snapshot.directPrompt = {
      positive: [completion.promptFixedPositive, completion.prompt].filter(Boolean).join("\n\n"),
      negative: completion.promptNegative || "",
      template: "flat_to_3d",
      referencePack: { inputAssetId: selectionAssets[0]?.id || "text-only", stylePresetId: "", styleAnchors: [] },
    };
    snapshot.agentId = "";
    snapshot.usePromptOrchestrator = false;
  }
  return snapshot;
}

async function generate(content) {
  const generationLimit = Math.min(3, Math.max(0, Number(state.session?.remainingToday) || 0));
  if (!state.session?.remainingToday) return toast("今日生成额度已用完");
  if (state.activeRequests.size >= generationLimit) return toast(`当前最多可运行 ${generationLimit} 个生成任务`);
  const selectionAssets = state.assets.map((asset) => ({ ...asset }));
  state.assets = [];
  renderAttachments();
  const controller = new AbortController();
  const localId = crypto.randomUUID();
  const workspaceId = state.workspaceId;
  const userMessage = addMessage("user", content);
  const pending = addMessage("system", "正在准备生成任务…", true);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "cancel-task";
  cancel.textContent = "暂停任务";
  cancel.addEventListener("click", () => {
    cancel.disabled = true;
    cancel.textContent = "正在暂停…";
    controller.abort();
  });
  pending.append(cancel);
  const taskEntry = { id: localId, prompt: content, status: "processing", anchor: pending };
  state.tasks.push(taskEntry);
  state.activeRequests.set(localId, controller);
  renderTasks();
  updateGenerateState();
  try {
    const snapshot = await buildGenerationSnapshot(content, selectionAssets, controller.signal);
    const conversationId = await ensureConversation(snapshot, workspaceId);
    pending.querySelector(".progress-line span:last-child").textContent = "正在生成图片，请稍候…";
    const response = await api(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    });
    const data = await responseJson(response, "生成失败");
    pending.className = "message system";
    pending.textContent = data.conversation.messages.at(-1)?.content || "生成完成";
    taskEntry.status = "completed";
    taskEntry.anchor = pending;
    if (workspaceId === state.workspaceId) renderResults(data.task, content, pending);
    if (state.token) refreshSession().catch(() => toast("图片已生成，但额度刷新暂时失败"));
  } catch (error) {
    pending.className = "message error";
    pending.textContent = error.name === "AbortError" ? "任务已暂停，额度将自动退回。" : error.message;
    taskEntry.status = "failed";
    userMessage.scrollIntoView({ block: "nearest" });
    if (state.token) refreshSession().catch(() => undefined);
  } finally {
    state.activeRequests.delete(localId);
    renderTasks();
    updateGenerateState();
  }
}

function updateGenerateState() {
  const active = state.activeRequests.size;
  const limit = Math.min(3, Math.max(0, Number(state.session?.remainingToday) || 0));
  elements.generate.disabled = active >= limit || !limit;
  elements.generate.querySelector("span").textContent = active ? `继续生成（${active}/3）` : "开始生成";
}

function resetWorkspace() {
  state.workspaceId += 1;
  state.conversationId = null;
  state.assets = [];
  elements.feed.replaceChildren();
  elements.results.replaceChildren();
  elements.resultsSection.hidden = true;
  elements.empty.hidden = false;
  elements.prompt.value = "";
  renderAttachments();
}

export {
  $, TOKEN_KEY, api, checkHealth, clearSession, elements, fileToAsset, generate,
  loadConfig, refreshSession, renderAttachments, renderMember, renderTasks,
  resetWorkspace, responseJson, saveSettings, showLogin, state, toast,
  updateGenerateState,
};
