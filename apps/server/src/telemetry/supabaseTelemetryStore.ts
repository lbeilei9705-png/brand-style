import type { TelemetryEvent, TelemetryQuery, TelemetryStats } from "../../../../packages/shared/src/index.ts";
import { calculateTelemetryStats, type TelemetryStore } from "./store.ts";

export interface SupabaseTelemetryStoreOptions {
  url: string;
  serviceRoleKey: string;
  tableName?: string;
  fetch?: typeof globalThis.fetch;
}

interface TelemetryRow {
  payload: TelemetryEvent;
}

export class SupabaseTelemetryStore implements TelemetryStore {
  readonly enabled: boolean;
  private readonly restUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: SupabaseTelemetryStoreOptions) {
    const url = options.url.replace(/\/+$/, "");
    this.serviceRoleKey = options.serviceRoleKey;
    this.restUrl = `${url}/rest/v1/${options.tableName || "brand_style_telemetry"}`;
    this.fetcher = options.fetch || globalThis.fetch;
    this.enabled = Boolean(url && this.serviceRoleKey);
  }

  async append(event: TelemetryEvent): Promise<void> {
    await this.appendBatch([event]);
  }

  async appendBatch(events: TelemetryEvent[]): Promise<void> {
    if (!this.enabled || !events.length) {
      return;
    }

    const response = await this.fetcher(this.restUrl, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(events.map((event) => ({
        id: event.id,
        event_timestamp: event.timestamp,
        name: event.name,
        source: event.source,
        category: event.category,
        level: event.level,
        session_id: event.sessionId || null,
        client_session_id: event.clientSessionId || null,
        request_id: event.requestId || null,
        conversation_id: event.conversationId || null,
        issue_id: event.issueId || null,
        actor_id: event.actorId || null,
        task_id: event.taskId || null,
        payload: event,
      }))),
    });

    if (!response.ok) {
      throw new Error(`写入 Supabase 遥测失败：HTTP ${response.status}`);
    }
  }

  async query(query: TelemetryQuery = {}): Promise<TelemetryEvent[]> {
    if (!this.enabled) {
      return [];
    }

    const parameters = this.queryParameters(query);
    const response = await this.fetcher(`${this.restUrl}?${parameters.toString()}`, {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`查询 Supabase 遥测失败：HTTP ${response.status}`);
    }

    const rows = await response.json() as TelemetryRow[];
    return rows.map((row) => row.payload);
  }

  async stats(query: TelemetryQuery = {}): Promise<TelemetryStats> {
    const events: TelemetryEvent[] = [];
    const pageSize = 1_000;

    while (true) {
      const page = await this.query({
        ...query,
        offset: events.length,
        limit: pageSize,
      });
      events.push(...page);
      if (page.length < pageSize) {
        break;
      }
    }

    return calculateTelemetryStats(events);
  }

  private queryParameters(query: TelemetryQuery): URLSearchParams {
    const parameters = new URLSearchParams({
      select: "payload",
      order: `event_timestamp.${query.order === "asc" ? "asc" : "desc"}`,
      limit: String(Math.max(0, query.limit ?? 100)),
      offset: String(Math.max(0, query.offset || 0)),
    });

    if (query.from) parameters.set("event_timestamp", `gte.${query.from}`);
    if (query.to) parameters.append("event_timestamp", `lte.${query.to}`);
    if (query.names?.length) parameters.set("name", `in.(${query.names.map(quoteFilter).join(",")})`);
    if (query.categories?.length) parameters.set("category", `in.(${query.categories.map(quoteFilter).join(",")})`);
    if (query.levels?.length) parameters.set("level", `in.(${query.levels.map(quoteFilter).join(",")})`);
    if (query.source) parameters.set("source", `eq.${query.source}`);
    if (query.sessionId) parameters.set("session_id", `eq.${query.sessionId}`);
    if (query.clientSessionId) parameters.set("client_session_id", `eq.${query.clientSessionId}`);
    if (query.requestId) parameters.set("request_id", `eq.${query.requestId}`);
    if (query.conversationId) parameters.set("conversation_id", `eq.${query.conversationId}`);
    if (query.issueId) parameters.set("issue_id", `eq.${query.issueId}`);
    if (query.actorId) parameters.set("actor_id", `eq.${query.actorId}`);
    if (query.taskId) parameters.set("task_id", `eq.${query.taskId}`);
    return parameters;
  }

  private headers(): HeadersInit {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
    };
  }
}

function quoteFilter(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
