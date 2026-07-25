import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
loadEnv(path.join(root, ".env"));
const target = process.argv[2];

if (!target) {
  console.error("用法：npm run diagnose -- <issueId|requestId|诊断包.json>");
  process.exitCode = 1;
} else {
  const events = fs.existsSync(path.resolve(target))
    ? eventsFromBundle(path.resolve(target))
    : await findEvents(target);
  printDiagnosis(target, events);
}

async function findEvents(identifier) {
  const remote = process.env.BRAND_STYLE_DIAGNOSTICS_URL;
  const token = process.env.BRAND_STYLE_ADMIN_TOKEN || process.env.BRAND_STYLE_ACCESS_TOKEN;
  if (remote && token) {
    try {
      const field = identifier.startsWith("issue_") ? "issueId" : "requestId";
      const url = new URL("/api/admin/telemetry/events", remote);
      url.searchParams.set(field, identifier);
      url.searchParams.set("limit", "500");
      const response = await fetch(url, { headers: { "x-brand-style-token": token } });
      if (response.ok) return (await response.json()).events || [];
    } catch {
      // Local telemetry remains the deterministic fallback.
    }
  }

  const directory = process.env.TELEMETRY_LOCAL_DIR || "data/telemetry";
  const file = path.resolve(root, directory, "telemetry.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line);
        return matchesIdentifier(event, identifier) ? [event] : [];
      } catch {
        return [];
      }
    });
}

function eventsFromBundle(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  const bundle = value.bundle || value;
  return Array.isArray(bundle.events) ? bundle.events : [];
}

function matchesIdentifier(event, identifier) {
  return [
    event.issueId,
    event.requestId,
    event.clientSessionId,
    event.taskId,
    event.conversationId,
    event.properties?.issueId,
    event.properties?.requestId,
  ].includes(identifier);
}

function printDiagnosis(target, events) {
  console.log(`诊断目标：${target}`);
  console.log(`关联事件：${events.length}`);
  if (!events.length) {
    console.log("未找到事件。请确认本地 TELEMETRY_LOCAL_DIR，或配置 BRAND_STYLE_DIAGNOSTICS_URL 与管理员 Token。");
    return;
  }

  const ordered = [...events].sort((a, b) => Date.parse(a.timestamp || a.at) - Date.parse(b.timestamp || b.at));
  for (const event of ordered) {
    const properties = event.properties || event.metadata || {};
    const status = properties.statusCode ? ` HTTP ${properties.statusCode}` : "";
    const duration = properties.durationMs ? ` ${properties.durationMs}ms` : "";
    console.log(`${event.timestamp || event.at} [${event.level || "info"}] ${event.source || "unknown"} ${event.name}${status}${duration}`);
  }

  const failed = ordered.filter((event) => event.level === "error" || Number(event.properties?.statusCode) >= 400);
  const latest = failed.at(-1);
  if (latest) {
    console.log(`失败阶段：${latest.diagnostic?.component || latest.category || latest.name}`);
    console.log(`错误代码：${latest.diagnostic?.code || latest.properties?.errorCode || latest.name}`);
  }
  const requestId = ordered.find((event) => event.requestId)?.requestId;
  console.log(`建议复现：npm test${requestId ? `  # requestId=${requestId}` : ""}`);
  console.log("建议验证：npm run verify");
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
