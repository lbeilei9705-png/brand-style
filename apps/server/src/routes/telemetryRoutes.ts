import type http from "node:http";
import type { TelemetryEvent, TelemetryLevel, TelemetryQuery } from "../../../../packages/shared/src/index.ts";
import { sendJson } from "../http/response.ts";
import { readJsonRequest } from "../serverHttp.ts";
import { normalizeClientTelemetryEvents, redactDiagnosticContext, type TelemetryService } from "../telemetry/index.ts";

export interface TelemetryRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  telemetry: TelemetryService;
  actorId?: string;
  requestId: string;
  clientSessionId?: string;
  isAdmin: boolean;
}

const telemetryRateWindows = new Map<string, { count: number; resetAt: number }>();

export async function handleTelemetryRoutes(context: TelemetryRouteContext): Promise<boolean> {
  const { req, res, url, telemetry } = context;

  if (req.method === "POST" && url.pathname === "/api/telemetry/events") {
    const retryAfter = consumeTelemetryRateLimit(context);
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
      sendJson(res, 429, { error: "遥测上报过于频繁", code: "TELEMETRY_RATE_LIMITED" });
      return true;
    }
    const body = await readJsonRequest(req) as { events?: unknown; clientSessionId?: unknown };
    let inputs;
    try {
      inputs = normalizeClientTelemetryEvents(body.events, {
        source: "figma",
        actorId: context.actorId,
        clientSessionId: context.clientSessionId || safeId(body.clientSessionId),
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : "遥测事件格式无效",
        code: "INVALID_TELEMETRY_BATCH",
      });
      return true;
    }
    const events = await telemetry.batch(inputs);
    sendJson(res, 202, { accepted: events.length });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/telemetry/events") {
    const query = telemetryQuery(url.searchParams);
    const aggregateQuery = { ...query, offset: 0, limit: 50_000 };
    const [events, allEvents, stats] = await Promise.all([
      telemetry.query(query),
      telemetry.query(aggregateQuery),
      telemetry.stats(query),
    ]);
    const normalized = events.map(flattenEvent);
    const allNormalized = allEvents.map(flattenEvent);
    sendJson(res, 200, {
      events: normalized,
      summary: metricSummary(allNormalized, stats.total),
      stats,
      issues: issueSummary(allNormalized),
      aggregations: {
        errorTypes: countBy(allNormalized, "errorCode", true),
        models: countBy(allNormalized, "modelId"),
        skills: countBy(allNormalized, "skillId"),
      },
      facets: { sources: [...new Set(allNormalized.map((event) => event.source).filter(Boolean))] },
      fallback: telemetry.fallback(),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/diagnostics/export") {
    const body = await readJsonRequest(req) as Record<string, unknown>;
    const query = telemetryQueryFromBody(body);
    if (!context.isAdmin) {
      query.actorId = context.actorId;
      query.clientSessionId = context.clientSessionId;
    }
    const events = await telemetry.query({ ...query, limit: Math.min(query.limit || 500, 1_000) });
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      build: {
        version: process.env.npm_package_version || "unknown",
        commit: process.env.GITHUB_SHA || process.env.BUILD_HASH || "unknown",
      },
      environment: {
        node: process.version,
        provider: process.env.IMAGE_PROVIDER || "mock",
        telemetryFallback: telemetry.fallback(),
      },
      query,
      events,
      clientContext: body.clientContext ? redactDiagnosticContext(body.clientContext) : undefined,
      health: { ok: true },
    };
    sendJson(res, 200, {
      filename: `brand-style-diagnostics-${Date.now()}.json`,
      mimeType: "application/json",
      content: JSON.stringify(bundle, null, 2),
    });
    return true;
  }

  return false;
}

function telemetryQuery(parameters: URLSearchParams): TelemetryQuery {
  return {
    from: validDate(parameters.get("from")),
    to: validDate(parameters.get("to")),
    levels: validLevel(parameters.get("level")),
    source: safeId(parameters.get("source")),
    actorId: safeId(parameters.get("member") || parameters.get("actorId")),
    issueId: safeId(parameters.get("issueId")),
    requestId: safeId(parameters.get("requestId")),
    clientSessionId: safeId(parameters.get("clientSessionId")),
    limit: clampNumber(parameters.get("limit"), 200, 1_000),
    offset: clampNumber(parameters.get("offset"), 0, 100_000),
  };
}

function telemetryQueryFromBody(body: Record<string, unknown>): TelemetryQuery {
  return {
    from: validDate(body.from),
    to: validDate(body.to),
    levels: validLevel(body.level),
    source: safeId(body.source),
    actorId: safeId(body.member || body.actorId),
    issueId: safeId(body.issueId),
    requestId: safeId(body.requestId),
    clientSessionId: safeId(body.clientSessionId),
    limit: clampNumber(body.limit, 500, 1_000),
  };
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 160 ? trimmed : undefined;
}

function validDate(value: unknown): string | undefined {
  const text = safeId(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : undefined;
}

function validLevel(value: unknown): TelemetryLevel[] | undefined {
  return typeof value === "string" && ["debug", "info", "warn", "error"].includes(value)
    ? [value as TelemetryLevel]
    : undefined;
}

function clampNumber(value: unknown, fallback: number, maximum: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, Math.floor(parsed))) : fallback;
}

type FlatEvent = TelemetryEvent & Record<string, unknown>;

function flattenEvent(event: TelemetryEvent): FlatEvent {
  return {
    ...event.properties,
    ...event,
    source: event.source || String(event.properties.source || "server"),
    durationMs: Number(event.properties.durationMs || 0),
    modelId: event.properties.modelId,
    skillId: event.properties.skillId,
    errorCode: event.properties.errorCode,
    message: event.properties.errorSummary,
  };
}

function metricSummary(events: FlatEvent[], total = events.length): Record<string, number> {
  const durations = events.map((event) => Number(event.durationMs || 0)).filter((value) => value > 0).sort((a, b) => a - b);
  const successful = events.filter((event) => event.level !== "error" && Number(event.statusCode || 0) < 400).length;
  return {
    total,
    successRate: events.length ? successful / events.length : 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  };
}

function countBy(events: FlatEvent[], key: string, omitEmpty = false): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const value = String(event[key] || (omitEmpty ? "" : "未标记"));
    if (value) counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function percentile(values: number[], ratio: number): number {
  return values.length ? values[Math.max(0, Math.ceil(values.length * ratio) - 1)] : 0;
}

function issueSummary(events: FlatEvent[]): Array<Record<string, unknown>> {
  const issues = new Map<string, { title: string; message: string; count: number; issueId?: string }>();
  for (const event of events) {
    const errorCode = String(event.errorCode || (event.level === "error" ? event.name : ""));
    if (!errorCode) continue;
    const key = String(event.issueId || errorCode);
    const existing = issues.get(key) || {
      title: errorCode,
      message: String(event.message || ""),
      count: 0,
      issueId: event.issueId,
    };
    existing.count += 1;
    issues.set(key, existing);
  }
  return [...issues.values()].sort((left, right) => right.count - left.count);
}

function consumeTelemetryRateLimit(context: TelemetryRouteContext): number {
  const key = context.actorId
    || context.clientSessionId
    || context.req.socket.remoteAddress
    || "unknown";
  const now = Date.now();
  const current = telemetryRateWindows.get(key);
  if (!current || current.resetAt <= now) {
    telemetryRateWindows.set(key, { count: 1, resetAt: now + 60_000 });
    return 0;
  }
  current.count += 1;
  if (current.count <= 60) return 0;
  return Math.max(1, Math.ceil((current.resetAt - now) / 1_000));
}
