import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TelemetryEvent } from "../../../../packages/shared/src/index.ts";
import { getAppConfig } from "../config.ts";
import { LocalTelemetryStore } from "./localTelemetryStore.ts";
import { MAX_CLIENT_TELEMETRY_BATCH, normalizeClientTelemetryEvents } from "./normalizeClientTelemetry.ts";
import { REDACTED, REDACTED_SIGNED_URL, redactDiagnosticContext, redactTelemetryProperties } from "./redact.ts";
import type { TelemetryStore } from "./store.ts";
import { SupabaseTelemetryStore } from "./supabaseTelemetryStore.ts";
import { TelemetryService } from "./telemetryService.ts";

function event(id: string, timestamp: string, name = "generation.completed"): TelemetryEvent {
  return {
    id,
    timestamp,
    name,
    source: "figma",
    category: "generation",
    level: "info",
    sessionId: id.startsWith("keep") ? "session-a" : "session-b",
    clientSessionId: id.startsWith("keep") ? "client-a" : "client-b",
    requestId: id === "keep-3" ? "request-3" : undefined,
    conversationId: id.startsWith("keep") ? "conversation-a" : undefined,
    issueId: id === "keep-3" ? "issue-3" : undefined,
    properties: {},
  };
}

test("recursive redaction removes sensitive fields and signed URLs", () => {
  const redacted = redactTelemetryProperties({
    apiKey: "secret",
    nested: {
      authorization: "Bearer secret",
      safe: "visible",
      errorMessage: "upstream echoed private user text",
      image: "data:image/png;base64,AAAA",
      download: "https://example.test/file?X-Amz-Signature=secret",
    },
    items: [{ prompt: "private prompt" }],
  });

  assert.equal(redacted.apiKey, REDACTED);
  assert.deepEqual(redacted.nested, {
    authorization: REDACTED,
    safe: "visible",
      errorMessage: REDACTED,
    image: REDACTED,
    download: REDACTED_SIGNED_URL,
  });
  assert.deepEqual(redacted.items, [{ prompt: REDACTED }]);
  assert.deepEqual(redactDiagnosticContext({
    prompt: "user-approved prompt",
    apiKey: "sk-private-value-123456",
  }), {
    prompt: "user-approved prompt",
    apiKey: REDACTED,
  });
});

test("local JSONL store serializes writes, prunes age and maxEvents, then queries", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-telemetry-"));
  const now = new Date("2026-07-25T00:00:00.000Z");
  const store = new LocalTelemetryStore({
    dataDir,
    retentionDays: 30,
    maxEvents: 2,
    now: () => now,
  });

  try {
    await Promise.all([
      store.append(event("old", "2026-06-01T00:00:00.000Z")),
      store.append(event("keep-1", "2026-07-23T00:00:00.000Z")),
      store.append(event("keep-2", "2026-07-24T00:00:00.000Z", "generation.failed")),
      store.append(event("keep-3", "2026-07-25T00:00:00.000Z")),
    ]);

    const results = await store.query({
      names: ["generation.completed"],
      source: "figma",
      sessionId: "session-a",
      clientSessionId: "client-a",
      requestId: "request-3",
      conversationId: "conversation-a",
      issueId: "issue-3",
      order: "asc",
    });
    assert.deepEqual(results.map((item) => item.id), ["keep-3"]);

    const lines = fs.readFileSync(store.filePath, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((line) => JSON.parse(line).id), ["keep-2", "keep-3"]);

    const stats = await store.stats({ categories: ["generation"] });
    assert.equal(stats.total, 2);
    assert.deepEqual(stats.byName, {
      "generation.failed": 1,
      "generation.completed": 1,
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("service falls back locally and exposes diagnostic events", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-telemetry-fallback-"));
  const local = new LocalTelemetryStore({ dataDir });
  const remote: TelemetryStore = {
    enabled: true,
    async append() { throw new Error("remote unavailable"); },
    async appendBatch() { throw new Error("remote unavailable"); },
    async query() { throw new Error("remote unavailable"); },
    async stats() { throw new Error("remote unavailable"); },
  };
  const service = new TelemetryService({
    primary: remote,
    fallback: local,
    now: () => new Date("2026-07-25T00:00:00.000Z"),
    createId: (() => {
      let id = 0;
      return () => `event-${++id}`;
    })(),
  });

  try {
    const recorded = await service.record({
      name: "generation.completed",
      source: "admin",
      clientSessionId: "client-service",
      requestId: "request-service",
      conversationId: "conversation-service",
      issueId: "issue-service",
      properties: { token: "secret", safe: true },
    });
    assert.equal(recorded.properties.token, REDACTED);
    assert.equal(recorded.source, "admin");
    assert.equal(recorded.clientSessionId, "client-service");
    assert.equal(recorded.requestId, "request-service");
    assert.equal(recorded.conversationId, "conversation-service");
    assert.equal(recorded.issueId, "issue-service");

    const diagnostics = await service.queryDiagnostics();
    assert.ok(diagnostics.length >= 1);
    assert.equal(diagnostics[0]?.diagnostic.code, "REMOTE_STORE_FAILURE");
    assert.equal(service.fallback().active, true);
    assert.ok(service.fallback().count >= 2);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("recovered remote queries retain events written during fallback", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "icon-telemetry-recovery-"));
  const local = new LocalTelemetryStore({ dataDir: path.join(root, "local") });
  const remoteLocal = new LocalTelemetryStore({ dataDir: path.join(root, "remote") });
  let unavailable = true;
  const remote: TelemetryStore = {
    enabled: true,
    append: async (item) => unavailable ? Promise.reject(new Error("offline")) : remoteLocal.append(item),
    appendBatch: async (items) => unavailable ? Promise.reject(new Error("offline")) : remoteLocal.appendBatch(items),
    query: (query) => unavailable ? Promise.reject(new Error("offline")) : remoteLocal.query(query),
    stats: (query) => unavailable ? Promise.reject(new Error("offline")) : remoteLocal.stats(query),
  };
  const service = new TelemetryService({ primary: remote, fallback: local });

  try {
    await service.record({ name: "offline.event", source: "server" });
    unavailable = false;
    await service.record({ name: "online.event", source: "server" });
    const events = await service.query({ limit: 10 });
    assert.deepEqual(new Set(events.map((item) => item.name)), new Set([
      "offline.event",
      "online.event",
      "telemetry.remote_fallback",
    ]));
    assert.equal((await service.stats()).total, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Supabase REST store uses injected fetch without network access", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const stored: TelemetryEvent = {
    ...event("remote-1", "2026-07-25T00:00:00.000Z"),
    requestId: "remote-request",
    conversationId: "remote-conversation",
    issueId: "remote-issue",
  };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (init?.method === "POST") {
      return new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify([{ payload: stored }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const store = new SupabaseTelemetryStore({
    url: "https://project.supabase.co/",
    serviceRoleKey: "test-key",
    fetch: fetcher,
  });

  await store.append(stored);
  const result = await store.query({
    names: [stored.name],
    source: "figma",
    clientSessionId: "client-b",
    requestId: "remote-request",
    conversationId: "remote-conversation",
    issueId: "remote-issue",
    limit: 5,
  });

  assert.deepEqual(result, [stored]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.init?.method, "POST");
  assert.match(requests[1]?.url || "", /name=in/);
  assert.match(requests[1]?.url || "", /source=eq/);
  assert.match(requests[1]?.url || "", /client_session_id=eq/);
  assert.match(requests[1]?.url || "", /request_id=eq/);
  assert.match(requests[1]?.url || "", /conversation_id=eq/);
  assert.match(requests[1]?.url || "", /issue_id=eq/);
  assert.match(requests[0]?.url || "", /brand_style_telemetry$/);
  assert.equal((requests[0]?.init?.headers as Record<string, string>).apikey, "test-key");
  const [posted] = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(posted.source, "figma");
  assert.equal(posted.client_session_id, "client-b");
  assert.equal(posted.request_id, "remote-request");
  assert.equal(posted.conversation_id, "remote-conversation");
  assert.equal(posted.issue_id, "remote-issue");
});

test("client telemetry normalizer enforces shape, whitelist, limits and associations", async () => {
  assert.throws(() => normalizeClientTelemetryEvents({}, { source: "figma" }), TypeError);
  assert.throws(
    () => normalizeClientTelemetryEvents(
      Array.from({ length: MAX_CLIENT_TELEMETRY_BATCH + 1 }),
      { source: "figma" },
    ),
    RangeError,
  );

  const tooLongName = "x".repeat(101);
  const normalized = normalizeClientTelemetryEvents([
    {
      eventId: "untrusted-event-id",
      name: "client_error",
      level: "warn",
      at: "2026-07-25T01:02:03.000Z",
      clientSessionId: "raw-client",
      metadata: {
        requestId: "metadata-request",
        conversationId: "metadata-conversation",
        issueId: "metadata-issue",
        prompt: "private",
        safe: true,
      },
    },
    { name: "not_allowed", metadata: {} },
    { name: tooLongName, metadata: {} },
  ], {
    source: "figma",
    clientSessionId: "context-client",
    requestId: "context-request",
    allowedEventNames: new Set(["client_error", tooLongName]),
  });

  assert.equal(normalized.length, 1);
  assert.deepEqual(normalized[0], {
    name: "client_error",
    source: "figma",
    category: "client",
    level: "warn",
    timestamp: "2026-07-25T01:02:03.000Z",
    sessionId: undefined,
    clientSessionId: "context-client",
    requestId: "context-request",
    conversationId: "metadata-conversation",
    issueId: "metadata-issue",
    actorId: undefined,
    taskId: undefined,
    properties: {
      requestId: "metadata-request",
      conversationId: "metadata-conversation",
      issueId: "metadata-issue",
      prompt: "private",
      safe: true,
      clientEventId: "untrusted-event-id",
    },
  });

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-client-telemetry-"));
  try {
    const service = new TelemetryService({ fallback: new LocalTelemetryStore({ dataDir }) });
    const [stored] = await service.batch(normalized);
    assert.equal(stored?.properties.prompt, REDACTED);
    assert.notEqual(stored?.id, "untrusted-event-id");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("telemetry environment values are parsed with safe defaults", () => {
  const keys = [
    "TELEMETRY_ENABLED",
    "TELEMETRY_STORE",
    "TELEMETRY_LOCAL_DIR",
    "TELEMETRY_RETENTION_DAYS",
    "TELEMETRY_MAX_EVENTS",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_TELEMETRY_TABLE",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    process.env.TELEMETRY_ENABLED = "false";
    process.env.TELEMETRY_STORE = "supabase";
    process.env.TELEMETRY_LOCAL_DIR = "/tmp/telemetry-test";
    process.env.TELEMETRY_RETENTION_DAYS = "-1";
    process.env.TELEMETRY_MAX_EVENTS = "250";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    delete process.env.SUPABASE_TELEMETRY_TABLE;

    const config = getAppConfig().telemetry;
    assert.equal(config.enabled, false);
    assert.equal(config.store, "supabase");
    assert.equal(config.localDir, "/tmp/telemetry-test");
    assert.equal(config.retentionDays, 30);
    assert.equal(config.maxEvents, 250);
    assert.equal(config.supabase?.tableName, "brand_style_telemetry");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});
