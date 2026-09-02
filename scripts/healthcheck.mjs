const baseUrl = (process.env.BRAND_STYLE_HEALTH_URL || "http://127.0.0.1:5180").replace(/\/+$/, "");
const timeoutMs = Math.max(1_000, Number(process.env.BRAND_STYLE_HEALTH_TIMEOUT_MS || 10_000));
const webhookUrl = process.env.BRAND_STYLE_ALERT_WEBHOOK_URL || "";

async function notify(message) {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: message }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => undefined);
}

try {
  const response = await fetch(`${baseUrl}/api/health`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let health;
  try {
    health = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status}; non-JSON response`);
  }

  if (!response.ok || !health.ok || health.ready === false) {
    throw new Error(`HTTP ${response.status}; ready=${String(health.ready)}`);
  }

  console.log(`Brand Style healthy: version=${health.build?.version || "unknown"}`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const message = `Brand Style healthcheck failed: ${reason}`;
  console.error(message);
  await notify(message);
  process.exitCode = 1;
}
