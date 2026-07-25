import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-api-contract-"));
const dataDir = path.join(temporaryRoot, "data");
const telemetryDir = path.join(temporaryRoot, "telemetry");
const adminToken = "contract-admin-token";
let child;

function getRandomPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForServer(server, port) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`服务启动超时。\n${output}`));
    }, 15_000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(`listening on http://localhost:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`服务启动前退出：code=${code}, signal=${signal}\n${output}`));
    });
  });
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.kill("SIGKILL");
    }, 3_000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`${options.method || "GET"} ${pathname} 返回非 JSON：${text}`);
  }
  return { response, body };
}

function adminHeaders() {
  return { "x-brand-style-token": adminToken };
}

function memberHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

async function main() {
  const port = await getRandomPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [
    "--experimental-strip-types",
    "apps/server/src/index.ts",
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      IMAGE_PROVIDER: "mock",
      BRAND_STYLE_ADMIN_TOKEN: adminToken,
      BRAND_STYLE_ACCESS_TOKEN: "",
      BRAND_STYLE_DATA_DIR: dataDir,
      BRAND_STYLE_MEMBER_DAILY_LIMIT: "1",
      BRAND_STYLE_PLUGIN_RATE_LIMIT: "100",
      BRAND_STYLE_PLUGIN_GLOBAL_RATE_LIMIT: "1000",
      TELEMETRY_ENABLED: "true",
      TELEMETRY_STORE: "local",
      TELEMETRY_LOCAL_DIR: telemetryDir,
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      OSS_ENABLED: "false",
      FINTOPIA_API_KEY: "",
      GOOGLE_API_TOKEN: "",
      YUNWU_IMAGE_API_KEY: "",
      YUNWU_LANGUAGE_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(child, port);

  const health = await request(baseUrl, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.provider, "mock");
  assert.equal(health.body.storage.telemetry, "local");

  const unauthorized = await request(baseUrl, "/api/admin/member-access");
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.body.error, "Unauthorized.");

  const invite = await request(baseUrl, "/api/admin/member-invites", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      memberName: "API Contract Member",
      dailyLimit: 1,
      expiresInHours: 1,
    }),
  });
  assert.equal(invite.response.status, 201);
  assert.match(invite.body.code, /^BS-/);

  const redeem = await request(baseUrl, "/api/member/session/redeem", {
    method: "POST",
    body: JSON.stringify({ code: invite.body.code.toLowerCase() }),
  });
  assert.equal(redeem.response.status, 201);
  assert.match(redeem.body.sessionToken, /^bst_/);
  assert.equal(redeem.body.session.remainingToday, 1);
  const memberToken = redeem.body.sessionToken;

  const session = await request(baseUrl, "/api/member/session/me", {
    headers: memberHeaders(memberToken),
  });
  assert.equal(session.response.status, 200);
  assert.equal(session.body.session.memberName, "API Contract Member");

  const config = await request(baseUrl, "/api/config/models", {
    headers: memberHeaders(memberToken),
  });
  assert.equal(config.response.status, 200);
  assert.ok(config.body.models.some((model) => model.id === "mock-preview"));
  assert.ok(config.body.models.every((model) => !("apiKey" in model)));

  const createdConversation = await request(baseUrl, "/api/conversations", {
    method: "POST",
    headers: memberHeaders(memberToken),
    body: JSON.stringify({
      title: "Contract conversation",
      modelId: "mock-preview",
      agentId: "",
    }),
  });
  assert.equal(createdConversation.response.status, 201);
  assert.match(createdConversation.body.conversation.id, /^conv_[0-9a-f-]{36}$/);
  const conversationId = createdConversation.body.conversation.id;

  const messageBody = {
    content: "生成一个确定性测试图标",
    modelId: "mock-preview",
    agentId: "",
    inputType: "auto",
    selectionAssets: [],
    batchSize: 1,
    aspectRatio: "1:1",
    resolution: "1k",
    usePromptOrchestrator: false,
  };
  const firstMessage = await request(baseUrl, `/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: memberHeaders(memberToken),
    body: JSON.stringify(messageBody),
  });
  assert.equal(firstMessage.response.status, 201);
  assert.equal(firstMessage.body.task.results[0].meta.provider, "mock");
  assert.equal(firstMessage.body.task.results[0].meta.seed, 1001);

  const quotaDenied = await request(baseUrl, `/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: memberHeaders(memberToken),
    body: JSON.stringify(messageBody),
  });
  assert.equal(quotaDenied.response.status, 429);
  assert.equal(quotaDenied.body.code, "MEMBER_DAILY_LIMIT_REACHED");
  assert.equal(quotaDenied.body.quota.remainingToday, 0);

  const createdTask = await request(baseUrl, "/api/tasks", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      inputType: "auto",
      source: "web_upload",
      filename: "contract.png",
      mimeType: "image/png",
      sizeBytes: 1,
      batchSize: 2,
      aspectRatio: "4:3",
      resolution: "1k",
      target: "web",
    }),
  });
  assert.equal(createdTask.response.status, 201);
  assert.equal(createdTask.body.task.results.length, 2);
  assert.deepEqual(
    createdTask.body.task.results.map((result) => result.meta.seed),
    [1001, 1002],
  );

  const task = await request(baseUrl, `/api/tasks/${createdTask.body.taskId}`, {
    headers: adminHeaders(),
  });
  assert.equal(task.response.status, 200);
  assert.equal(task.body.task.id, createdTask.body.taskId);

  const telemetry = await request(baseUrl, "/api/telemetry/events", {
    method: "POST",
    headers: memberHeaders(memberToken),
    body: JSON.stringify({
      clientSessionId: "contract-client",
      events: [{
        eventId: "contract-event-1",
        name: "generation_success",
        level: "info",
        at: "2026-07-25T00:00:00.000Z",
        metadata: { durationMs: 12, taskId: createdTask.body.taskId },
      }],
    }),
  });
  assert.equal(telemetry.response.status, 202);
  assert.equal(telemetry.body.accepted, 1);

  const telemetryQuery = await request(baseUrl, "/api/admin/telemetry/events?clientSessionId=contract-client&limit=20", {
    headers: adminHeaders(),
  });
  assert.equal(telemetryQuery.response.status, 200);
  assert.ok(telemetryQuery.body.events.some((event) => event.name === "generation_success"));
  assert.ok(telemetryQuery.body.summary.total >= 1);
  const defaultTelemetryQuery = await request(baseUrl, "/api/admin/telemetry/events", {
    headers: adminHeaders(),
  });
  assert.ok(defaultTelemetryQuery.body.events.length > 0);

  const diagnostics = await request(baseUrl, "/api/diagnostics/export", {
    method: "POST",
    headers: memberHeaders(memberToken),
    body: JSON.stringify({
      clientSessionId: "contract-client",
      limit: 20,
      clientContext: {
        source: "api-contract",
        prompt: "explicit diagnostic prompt",
        apiKey: "must-not-export",
      },
    }),
  });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.mimeType, "application/json");
  const bundle = JSON.parse(diagnostics.body.content);
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.clientContext.prompt, "explicit diagnostic prompt");
  assert.equal(bundle.clientContext.apiKey, "[REDACTED]");
  assert.ok(!diagnostics.body.content.includes("must-not-export"));
  assert.equal(bundle.health.ok, true);
  assert.equal(bundle.clientContext.source, "api-contract");
  assert.ok(bundle.events.some((event) => event.name === "generation_success"));

  assert.ok(fs.existsSync(path.join(dataDir, "config.json")));
  assert.ok(fs.existsSync(path.join(dataDir, "member-access.json")));
  assert.equal(path.dirname(dataDir), temporaryRoot);
  console.log("API contract passed: health/auth/invites/quota/config/conversations/tasks/telemetry/diagnostics");
}

try {
  await main();
} finally {
  await stopServer(child);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
