import { escapeHtml, qs, renderStatus, safeImageUrl, state } from "./core.js";

export function renderModels() {
  const table = qs("#models-table");
  table.innerHTML = "";

  for (const model of state.models) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(model.name)}</strong>
        <span class="muted">${escapeHtml(model.model)}</span>
      </td>
      <td>${escapeHtml(model.provider)} / ${model.purpose === "language" ? "语言" : "生图"}</td>
      <td>${escapeHtml(model.apiStyle || "azure")} / ${escapeHtml(model.apiVersion || "无版本")} / ${escapeHtml(model.quality)}</td>
      <td>${renderStatus(model.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-model" data-id="${escapeHtml(model.id)}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-model" data-id="${escapeHtml(model.id)}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

export function renderAgentDriverOptions() {
  const select = qs("#agent-driver-model");
  const importSelect = qs("#import-driver-model");
  const scenarioAgentSelect = qs("#scenario-agent-driver-model");
  const scenarioAgentCaseSelect = qs("#scenario-agent-case-agent");
  select.innerHTML = "";
  importSelect.innerHTML = "";
  scenarioAgentSelect.innerHTML = "";
  scenarioAgentCaseSelect.innerHTML = "";

  for (const model of state.models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    select.appendChild(option);
    importSelect.appendChild(option.cloneNode(true));
    scenarioAgentSelect.appendChild(option.cloneNode(true));
  }

  for (const agent of state.scenarioAgents) {
    const option = document.createElement("option");
    option.value = agent.id;
    option.textContent = `${agent.name}（${agent.trigger}）`;
    scenarioAgentCaseSelect.appendChild(option);
  }
}

export function renderAgents() {
  const table = qs("#agents-table");
  table.innerHTML = "";

  for (const agent of state.agents) {
    const driver = state.models.find((model) => model.id === agent.driverModelId);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(agent.name)}</strong>
        <span class="muted">${escapeHtml(agent.description)}</span>
      </td>
      <td>${escapeHtml(driver?.name || agent.driverModelId || "-")}</td>
      <td>${renderStatus(agent.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-agent" data-id="${escapeHtml(agent.id)}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-agent" data-id="${escapeHtml(agent.id)}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

export function renderMaterials() {
  const table = qs("#materials-table");
  table.innerHTML = "";

  for (const material of state.materials) {
    const previewUrl = safeImageUrl(material.previewImageUrl);
    const preview = previewUrl
      ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(material.name)}" loading="lazy" />`
      : `<span class="material-thumb-fallback"></span>`;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="material-cell">
          <span class="material-thumb">${preview}</span>
          <div>
            <strong>${escapeHtml(material.name)}</strong>
            <span class="muted">${previewUrl ? "已配置预览图" : "未配置预览图"}</span>
          </div>
        </div>
      </td>
      <td>${escapeHtml(material.prompt)}</td>
      <td>${renderStatus(material.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-material" data-id="${escapeHtml(material.id)}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-material" data-id="${escapeHtml(material.id)}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

function renderColorSwatches(colors) {
  return colors.map((color) => {
    const safeColor = /^#[0-9a-f]{3,8}$/i.test(String(color)) ? color : "transparent";
    return `<span title="${escapeHtml(color)}" style="display:inline-block;width:18px;height:18px;border-radius:999px;border:1px solid #d0d5dd;background:${safeColor};"></span>`;
  }).join("");
}

export function renderPalettes() {
  const table = qs("#palettes-table");
  table.innerHTML = "";

  for (const palette of state.colorPalettes) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(palette.name)}</strong>
        <span class="muted">${escapeHtml(palette.description)}</span>
      </td>
      <td><div style="display:flex;gap:6px;align-items:center;">${renderColorSwatches(palette.colors)}</div><span class="muted">${escapeHtml(palette.colors.join(" / "))}</span></td>
      <td>${escapeHtml(palette.prompt)}</td>
      <td>${renderStatus(palette.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-palette" data-id="${escapeHtml(palette.id)}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-palette" data-id="${escapeHtml(palette.id)}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

export function renderShapeArchitectures() {
  const table = qs("#shape-architectures-table");
  table.innerHTML = "";

  for (const architecture of state.shapeArchitectures) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(architecture.name)}</strong>
        <span class="muted">${escapeHtml(architecture.description)}</span>
      </td>
      <td>${escapeHtml(architecture.prompt)}</td>
      <td>${renderStatus(architecture.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-shape-architecture" data-id="${escapeHtml(architecture.id)}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-shape-architecture" data-id="${escapeHtml(architecture.id)}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

export function renderScenarios() {
  const table = qs("#scenarios-table");
  table.innerHTML = "";

  for (const scenario of state.operationScenarios) {
    const fixedPrompt = scenario.fixedPrompt || scenario.content || "";
    const variablePrompt = scenario.variablePrompt || "";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(scenario.name)}</strong>
        <span class="muted">${escapeHtml(scenario.description)}</span>
      </td>
      <td>${escapeHtml(fixedPrompt)}</td>
      <td>${escapeHtml(variablePrompt)}</td>
      <td>${renderStatus(scenario.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-scenario" data-id="${escapeHtml(scenario.id)}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-scenario" data-id="${escapeHtml(scenario.id)}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

export function renderScenarioAgents() {
  const table = qs("#scenario-agents-table");
  table.innerHTML = "";

  for (const agent of state.scenarioAgents) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(agent.name)}</strong>
        <span class="muted">${escapeHtml(agent.description)}</span>
      </td>
      <td><strong>${escapeHtml(agent.trigger)}</strong><span class="muted">${escapeHtml(agent.version || "-")}</span></td>
      <td>${agent.outputMode === "json_final_prompt" ? "JSON finalPrompt" : "prompt_main / prompt_negative"}</td>
      <td>${renderStatus(agent.enabled)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" data-action="edit-scenario-agent" data-id="${escapeHtml(agent.id)}" type="button">编辑</button>
          <button class="danger-button" data-action="delete-scenario-agent" data-id="${escapeHtml(agent.id)}" type="button">删除</button>
        </div>
      </td>
    `;
    table.appendChild(row);
  }
}

export function renderScenarioAgentCases() {
  const container = qs("#scenario-agent-cases-groups");
  container.innerHTML = "";
  const ratingText = {
    excellent: "优秀",
    neutral: "一般",
    failed: "失败",
  };
  const groups = state.scenarioAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    trigger: agent.trigger,
    description: agent.description,
    items: state.scenarioAgentCases.filter((item) => item.scenarioAgentId === agent.id),
  }));
  const unmatchedItems = state.scenarioAgentCases.filter((item) => (
    !state.scenarioAgents.some((agent) => agent.id === item.scenarioAgentId)
  ));

  if (unmatchedItems.length) {
    groups.push({
      id: "__unmatched__",
      name: "未匹配 Skill",
      trigger: "案例所属 Skill 已删除或不可用",
      description: "这些案例仍保留在案例库中，但当前找不到对应场景 Skill 配置。",
      items: unmatchedItems,
    });
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "case-group";
    const rows = group.items.map((item) => `
      <tr>
        <td>
          <div class="material-cell">
            <span class="material-thumb">${
              safeImageUrl(item.thumbnailUrl || item.imageUrl)
                ? `<img src="${escapeHtml(safeImageUrl(item.thumbnailUrl || item.imageUrl))}" alt="${escapeHtml(item.title)}" loading="lazy" />`
                : '<span class="material-thumb-fallback"></span>'
            }</span>
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <span class="muted">${escapeHtml(item.userInput)}</span>
            </div>
          </div>
        </td>
        <td>
          <strong>${escapeHtml(ratingText[item.rating] || item.rating)}</strong>
          <span class="muted">${escapeHtml((item.tags || []).join(" / ") || "-")}</span>
        </td>
        <td>${renderStatus(item.enabled)}</td>
        <td>
          <div class="row-actions">
            <button class="secondary-button" data-action="edit-scenario-agent-case" data-id="${escapeHtml(item.id)}" type="button">编辑</button>
            <button class="danger-button" data-action="delete-scenario-agent-case" data-id="${escapeHtml(item.id)}" type="button">删除</button>
          </div>
        </td>
      </tr>
    `).join("");

    section.innerHTML = `
      <header class="case-group-header">
        <div>
          <h3>${escapeHtml(group.name)}</h3>
          <p class="muted">${escapeHtml(group.trigger)}${group.description ? ` · ${escapeHtml(group.description)}` : ""}</p>
        </div>
        <span class="case-count">${group.items.length} 个案例</span>
      </header>
      <table>
        <thead>
          <tr>
            <th>案例</th>
            <th>标签 / 评分</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">暂无案例</td></tr>'}</tbody>
      </table>
    `;
    container.appendChild(section);
  }
}

function formatAccessDate(value) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}

export function renderMemberAccess() {
  const membersTable = qs("#member-access-members-table");
  const invitesTable = qs("#member-access-invites-table");
  membersTable.innerHTML = state.members.map((member) => `
    <tr>
      <td>
        <strong>${escapeHtml(member.name)}</strong>
        <span class="muted">${escapeHtml(formatAccessDate(member.createdAt))} 加入</span>
      </td>
      <td>${escapeHtml(member.usedToday)} / ${escapeHtml(member.dailyLimit)}<span class="muted">剩余 ${escapeHtml(member.remainingToday)}</span></td>
      <td>${escapeHtml(member.sessionCount)}</td>
      <td>${renderStatus(member.enabled)}</td>
      <td>
        ${member.enabled
          ? `<button class="danger-button" data-action="revoke-member" data-id="${escapeHtml(member.id)}" type="button">撤销访问</button>`
          : '<span class="muted">已撤销</span>'}
      </td>
    </tr>
  `).join("") || '<tr><td colspan="5" class="muted">暂无成员，请先生成邀请码。</td></tr>';

  const inviteStatusLabels = {
    active: "待使用",
    redeemed: "已使用",
    expired: "已过期",
    revoked: "已作废",
  };
  invitesTable.innerHTML = state.memberInvites.map((invite) => `
    <tr>
      <td>
        <strong>${escapeHtml(invite.memberName)}</strong>
        <span class="muted">${escapeHtml(formatAccessDate(invite.createdAt))} 创建</span>
      </td>
      <td>${escapeHtml(invite.dailyLimit)} 次/日</td>
      <td>${escapeHtml(formatAccessDate(invite.expiresAt))}</td>
      <td><span class="pill${invite.status === "active" ? "" : " off"}">${escapeHtml(inviteStatusLabels[invite.status] || invite.status)}</span></td>
      <td>
        ${invite.status === "active"
          ? `<button class="danger-button" data-action="revoke-member-invite" data-id="${escapeHtml(invite.id)}" type="button">作废</button>`
          : '<span class="muted">—</span>'}
      </td>
    </tr>
  `).join("") || '<tr><td colspan="5" class="muted">暂无邀请码记录。</td></tr>';
}
