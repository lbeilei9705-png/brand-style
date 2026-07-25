import { escapeHtml, openModal, qs, requestJson } from "./core.js";

export const telemetryState = {
  events: [],
  payload: {},
  loaded: false,
  filters: {},
};

function firstValue(item, keys, fallback = "") {
  for (const key of keys) {
    if (item?.[key] !== undefined && item[key] !== null) {
      return item[key];
    }
  }
  return fallback;
}

function normalizedEvent(item, index) {
  const level = String(firstValue(item, ["level", "severity"], "info")).toLowerCase();
  const status = String(firstValue(item, ["status", "outcome"], "")).toLowerCase();
  const successful = item?.success !== undefined
    ? Boolean(item.success)
    : level !== "error" && !["error", "failed", "failure"].includes(status);
  return {
    raw: item,
    id: String(firstValue(item, ["id", "eventId", "requestId", "traceId"], `event-${index}`)),
    time: firstValue(item, ["timestamp", "createdAt", "time", "occurredAt"]),
    level: ["error", "warn", "info"].includes(level) ? level : "info",
    source: String(firstValue(item, ["source", "service", "component"], "unknown")),
    type: String(firstValue(item, ["type", "event", "eventName", "name"], "事件")),
    message: String(firstValue(item, ["message", "errorMessage", "description"], "")),
    duration: Number(firstValue(item, ["durationMs", "latencyMs", "elapsedMs", "duration"], 0)) || 0,
    model: String(firstValue(item, ["model", "modelName", "modelId"], "未标记")),
    skill: String(firstValue(item, ["skill", "skillName", "skillId", "scenarioAgent"], "未标记")),
    errorType: String(firstValue(item, ["errorType", "errorCode", "code"], successful ? "" : "UnknownError")),
    successful,
  };
}

function eventList(payload) {
  const list = payload?.events || payload?.items || payload?.data?.events || payload?.data?.items || [];
  return Array.isArray(list) ? list : [];
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const milliseconds = Number(value);
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)} s` : `${Math.round(milliseconds)} ms`;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)];
}

function countBy(events, key, omitEmpty = false) {
  const counts = new Map();
  for (const event of events) {
    const value = event[key];
    if (omitEmpty && !value) continue;
    counts.set(value || "未标记", (counts.get(value || "未标记") || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function normalizedDistribution(value) {
  if (Array.isArray(value)) {
    return value.map((item) => ({
      name: String(firstValue(item, ["name", "key", "label", "type"], "未标记")),
      count: Number(firstValue(item, ["count", "value", "total"], 0)) || 0,
    }));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([name, count]) => ({ name, count: Number(count) || 0 }));
  }
  return [];
}

function distributionFromPayload(payload, keys, fallback) {
  const aggregations = payload?.aggregations || payload?.breakdowns || payload?.data?.aggregations || {};
  for (const key of keys) {
    const result = normalizedDistribution(aggregations[key] ?? payload?.[key]);
    if (result.length) return result.sort((a, b) => b.count - a.count);
  }
  return fallback;
}

function renderDistribution(selector, items) {
  const container = qs(selector);
  const max = Math.max(...items.map((item) => item.count), 1);
  container.innerHTML = items.slice(0, 8).map((item) => `
    <div class="distribution-item">
      <span>${escapeHtml(item.name)}</span><strong>${escapeHtml(item.count)}</strong>
      <span class="distribution-track"><span class="distribution-fill" style="width:${Math.max(3, (item.count / max) * 100)}%"></span></span>
    </div>
  `).join("") || '<span class="muted">暂无数据</span>';
}

function renderMetrics(payload, events) {
  const summary = payload?.summary || payload?.metrics || payload?.data?.summary || {};
  const durations = events.map((event) => event.duration).filter((value) => value > 0);
  const total = Number(firstValue(summary, ["total", "usage", "count"], events.length));
  const successes = events.filter((event) => event.successful).length;
  const successRateValue = firstValue(summary, ["successRate", "success_rate"], events.length ? successes / events.length : 0);
  const successRate = Number(successRateValue) > 1 ? Number(successRateValue) : Number(successRateValue) * 100;
  qs("#telemetry-total").textContent = total.toLocaleString("zh-CN");
  qs("#telemetry-success-rate").textContent = `${Math.max(0, successRate).toFixed(1)}%`;
  qs("#telemetry-p50").textContent = formatDuration(firstValue(summary, ["p50", "p50Ms", "latencyP50"], percentile(durations, 0.5)));
  qs("#telemetry-p95").textContent = formatDuration(firstValue(summary, ["p95", "p95Ms", "latencyP95"], percentile(durations, 0.95)));
}

function renderEvents(events) {
  qs("#telemetry-event-count").textContent = `${events.length} 条`;
  qs("#telemetry-events-table").innerHTML = events.map((event, index) => `
    <tr>
      <td>${escapeHtml(formatDate(event.time))}</td>
      <td><span class="telemetry-level ${event.level}">${escapeHtml(event.level)}</span></td>
      <td><strong>${escapeHtml(event.source)}</strong><span class="muted">${escapeHtml(event.type)}${event.message ? ` · ${escapeHtml(event.message)}` : ""}</span></td>
      <td>${escapeHtml(event.model)}<span class="muted">${escapeHtml(event.skill)}</span></td>
      <td>${escapeHtml(formatDuration(event.duration))}</td>
      <td><button class="secondary-button" data-action="view-telemetry-event" data-index="${index}" type="button">详情</button></td>
    </tr>
  `).join("") || '<tr><td colspan="6" class="muted">当前筛选范围内没有事件。</td></tr>';
}

function normalizedIssues(payload, events) {
  const issues = payload?.issues || payload?.data?.issues;
  if (Array.isArray(issues)) {
    return issues.map((item) => ({
      title: String(firstValue(item, ["title", "errorType", "type", "name"], "未分类异常")),
      message: String(firstValue(item, ["message", "description", "latestMessage"], "")),
      count: Number(firstValue(item, ["count", "occurrences", "total"], 1)) || 1,
    }));
  }
  return countBy(events, "errorType", true).map((item) => {
    const latest = events.find((event) => event.errorType === item.name);
    return { title: item.name, message: latest?.message || "暂无错误描述", count: item.count };
  });
}

function renderIssues(payload, events) {
  const issues = normalizedIssues(payload, events);
  qs("#telemetry-issue-count").textContent = `${issues.length} 项`;
  qs("#telemetry-issues").innerHTML = issues.map((issue) => `
    <article class="telemetry-issue">
      <strong>${escapeHtml(issue.title)}</strong><span class="telemetry-level error">${escapeHtml(issue.count)} 次</span>
      <p class="muted">${escapeHtml(issue.message)}</p>
    </article>
  `).join("") || '<div class="admin-card telemetry-panel"><span class="muted">当前范围内没有 Issue。</span></div>';
}

function renderSourceOptions(payload, events) {
  const select = qs("#telemetry-source");
  const selected = select.value;
  const facets = payload?.facets?.sources || payload?.sources || [];
  const values = [...new Set([
    selected,
    ...(Array.isArray(facets) ? facets.map((item) => typeof item === "string" ? item : item.name) : []),
    ...events.map((event) => event.source),
  ].filter(Boolean))].sort();
  select.replaceChildren(new Option("全部", ""), ...values.map((value) => new Option(value, value)));
  select.value = values.includes(selected) ? selected : "";
}

function renderTelemetry(payload) {
  const events = eventList(payload).map(normalizedEvent);
  telemetryState.events = events;
  telemetryState.payload = payload;
  renderMetrics(payload, events);
  const errorTypes = distributionFromPayload(payload, ["errorTypes", "errors"], countBy(events, "errorType", true));
  renderDistribution("#telemetry-error-types", errorTypes);
  renderDistribution("#telemetry-models", distributionFromPayload(payload, ["models", "modelDistribution"], countBy(events, "model")));
  renderDistribution("#telemetry-skills", distributionFromPayload(payload, ["skills", "skillDistribution"], countBy(events, "skill")));
  qs("#telemetry-error-count").textContent = `${errorTypes.reduce((sum, item) => sum + item.count, 0)} 个错误`;
  renderEvents(events);
  renderIssues(payload, events);
  renderSourceOptions(payload, events);
}

export function readTelemetryFilters() {
  const range = qs("#telemetry-range").value;
  const to = range === "custom" && qs("#telemetry-to").value ? new Date(qs("#telemetry-to").value) : new Date();
  const from = range === "custom" && qs("#telemetry-from").value ? new Date(qs("#telemetry-from").value) : new Date(to);
  if (range !== "custom") {
    const units = { "1h": 36e5, "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };
    from.setTime(to.getTime() - (units[range] || units["24h"]));
  }
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    level: qs("#telemetry-level").value,
    source: qs("#telemetry-source").value,
  };
}

export async function loadTelemetry() {
  const status = qs("#telemetry-status");
  status.classList.remove("error");
  status.textContent = "正在加载使用记录…";
  const filters = readTelemetryFilters();
  telemetryState.filters = filters;
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  try {
    const payload = await requestJson(`/api/admin/telemetry/events?${query}`);
    renderTelemetry(payload);
    telemetryState.loaded = true;
    status.textContent = `已更新 · ${formatDate(new Date())}`;
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message;
  }
}

export function showTelemetryEvent(index) {
  const event = telemetryState.events[index];
  if (!event) return;
  qs("#telemetry-detail-title").textContent = event.type;
  qs("#telemetry-detail-subtitle").textContent = `${formatDate(event.time)} · ${event.id}`;
  const fields = [["Level", event.level], ["Source", event.source], ["模型", event.model], ["Skill", event.skill], ["耗时", formatDuration(event.duration)], ["错误类型", event.errorType || "—"]];
  qs("#telemetry-detail-summary").innerHTML = fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  qs("#telemetry-detail-json").textContent = JSON.stringify(event.raw, null, 2);
  openModal("telemetry-detail-modal");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportDiagnostics() {
  const button = qs("#export-diagnostics-button");
  button.disabled = true;
  button.textContent = "正在打包…";
  try {
    const result = await requestJson("/api/diagnostics/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(telemetryState.filters || readTelemetryFilters()),
    });
    const file = result.data || result;
    const filename = String(file.filename || file.fileName || "brand-style-diagnostics.json").replace(/[^\w.-]+/g, "-");
    if (file.contentBase64) {
      const bytes = Uint8Array.from(atob(file.contentBase64), (character) => character.charCodeAt(0));
      downloadBlob(new Blob([bytes], { type: file.mimeType || "application/zip" }), filename);
    } else if (file.content !== undefined || file.bundle !== undefined) {
      const content = file.content ?? JSON.stringify(file.bundle, null, 2);
      downloadBlob(new Blob([content], { type: file.mimeType || "application/json" }), filename);
    } else {
      const downloadUrl = file.downloadUrl || file.url;
      if (!downloadUrl) throw new Error("诊断接口未返回可下载内容");
      const url = new URL(downloadUrl, window.location.origin);
      if (url.origin !== window.location.origin && url.protocol !== "https:") throw new Error("诊断包下载地址不安全");
      window.location.assign(url.href);
    }
  } catch (error) {
    const status = qs("#telemetry-status");
    status.classList.add("error");
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "下载诊断包";
  }
}
