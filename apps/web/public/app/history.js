export function createHistoryController({
  api,
  responseJson,
  elements,
  state,
  resetWorkspace,
  addMessage,
  toast,
}) {
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  }

  function render() {
    elements.taskCount.textContent = String(state.conversations.length + state.tasks.length);
    elements.taskList.replaceChildren();
    for (const task of [...state.tasks].reverse()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `task-item ${task.status}`;
      const dot = document.createElement("i");
      const label = document.createElement("span");
      label.textContent = task.prompt || "图片生成任务";
      button.append(dot, label);
      button.addEventListener("click", () => {
        task.anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      elements.taskList.append(button);
    }
    for (const conversation of state.conversations) {
      const row = document.createElement("div");
      row.className = "history-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "task-item history-conversation";
      button.setAttribute("aria-current", conversation.id === state.conversationId ? "true" : "false");
      const dot = document.createElement("i");
      const label = document.createElement("span");
      label.textContent = conversation.title || "新对话";
      const date = document.createElement("small");
      date.textContent = formatDate(conversation.updatedAt);
      button.append(dot, label, date);
      button.addEventListener("click", () => open(conversation.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "history-delete";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `删除会话：${conversation.title || "新对话"}`);
      remove.addEventListener("click", () => removeConversation(conversation));
      row.append(button, remove);
      elements.taskList.append(row);
    }
    if (!elements.taskList.childElementCount) {
      const empty = document.createElement("div");
      empty.className = "sidebar-empty";
      empty.textContent = "还没有历史创作";
      elements.taskList.append(empty);
    }
  }

  async function load() {
    const response = await api("/api/conversations");
    const data = await responseJson(response, "加载历史会话失败");
    state.conversations = (data.conversations || [])
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
    render();
  }

  async function open(conversationId) {
    try {
      const response = await api(`/api/conversations/${conversationId}`);
      const data = await responseJson(response, "打开历史会话失败");
      resetWorkspace();
      state.conversationId = data.conversation.id;
      elements.model.value = data.conversation.modelId || elements.model.value;
      elements.style.value = data.conversation.agentId || "";
      for (const message of data.conversation.messages) {
        addMessage(message.role === "user" ? "user" : "system", message.content);
      }
      if (!data.conversation.messages.length) elements.empty.hidden = false;
      render();
    } catch (error) {
      toast(error.message);
    }
  }

  async function removeConversation(conversation) {
    if (!confirm(`删除历史会话「${conversation.title || "新对话"}」？`)) return;
    try {
      const response = await api(`/api/conversations/${conversation.id}`, { method: "DELETE" });
      await responseJson(response, "删除历史会话失败");
      if (state.conversationId === conversation.id) resetWorkspace();
      await load();
    } catch (error) {
      toast(error.message);
    }
  }

  return { load, render };
}
