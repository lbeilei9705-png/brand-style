import { randomUUID } from "node:crypto";
import type {
  DiagnosticDetails,
  DiagnosticEvent,
  DiagnosticEventInput,
  TelemetryEvent,
  TelemetryEventInput,
  TelemetryFallbackState,
  TelemetryQuery,
  TelemetryStats,
} from "../../../../packages/shared/src/index.ts";
import { redactTelemetryProperties, redactTelemetryValue } from "./redact.ts";
import { filterTelemetryEvents, type TelemetryStore } from "./store.ts";

export interface TelemetryServiceOptions {
  primary?: TelemetryStore;
  fallback: TelemetryStore;
  enabled?: boolean;
  now?: () => Date;
  createId?: () => string;
}

export class TelemetryService {
  private readonly primary?: TelemetryStore;
  private readonly fallbackStore: TelemetryStore;
  private readonly enabled: boolean;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private fallbackState: TelemetryFallbackState = { active: false, count: 0 };

  constructor(options: TelemetryServiceOptions) {
    this.primary = options.primary;
    this.fallbackStore = options.fallback;
    this.enabled = options.enabled ?? true;
    this.now = options.now || (() => new Date());
    this.createId = options.createId || randomUUID;
  }

  async record(input: TelemetryEventInput): Promise<TelemetryEvent> {
    const event = this.createEvent(input);
    if (this.enabled) {
      await this.write([event]);
    }
    return event;
  }

  async batch(inputs: TelemetryEventInput[]): Promise<TelemetryEvent[]> {
    const events = inputs.map((input) => this.createEvent(input));
    if (this.enabled && events.length) {
      await this.write(events);
    }
    return events;
  }

  async recordDiagnostic(input: DiagnosticEventInput): Promise<DiagnosticEvent> {
    const event = this.createDiagnosticEvent(input);
    if (this.enabled) {
      await this.write([event]);
    }
    return event;
  }

  async query(query: TelemetryQuery = {}): Promise<TelemetryEvent[]> {
    if (!this.enabled) {
      return [];
    }
    if (!this.primary?.enabled) {
      return this.fallbackStore.query(query);
    }
    const expanded = {
      ...query,
      offset: 0,
      limit: Math.max(1, (query.offset || 0) + (query.limit ?? 100)),
    };
    try {
      const [remote, local] = await Promise.all([
        this.primary.query(expanded),
        this.fallbackStore.query(expanded),
      ]);
      this.fallbackState.active = false;
      return filterTelemetryEvents(uniqueEvents([...remote, ...local]), query);
    } catch (error) {
      const diagnostic = this.fallbackDiagnostic("query", error);
      await this.fallbackStore.append(diagnostic);
      return this.fallbackStore.query(query);
    }
  }

  async queryDiagnostics(query: Omit<TelemetryQuery, "categories"> = {}): Promise<DiagnosticEvent[]> {
    const events = await this.query({ ...query, categories: ["diagnostic"] });
    return events as DiagnosticEvent[];
  }

  async stats(query: TelemetryQuery = {}): Promise<TelemetryStats> {
    if (!this.enabled) {
      return emptyStats();
    }
    if (!this.primary?.enabled) {
      return this.fallbackStore.stats(query);
    }
    try {
      const [remote, local] = await Promise.all([
        this.primary.stats(query),
        this.fallbackStore.stats(query),
      ]);
      this.fallbackState.active = false;
      return mergeStats(remote, local);
    } catch (error) {
      const diagnostic = this.fallbackDiagnostic("stats", error);
      await this.fallbackStore.append(diagnostic);
      return this.fallbackStore.stats(query);
    }
  }

  fallback(): TelemetryFallbackState {
    return { ...this.fallbackState };
  }

  private createEvent(input: TelemetryEventInput): TelemetryEvent {
    return {
      id: this.createId(),
      name: input.name,
      source: input.source || "server",
      category: input.category || "product",
      level: input.level || "info",
      timestamp: normalizeTimestamp(input.timestamp, this.now),
      sessionId: input.sessionId,
      clientSessionId: input.clientSessionId,
      requestId: input.requestId,
      conversationId: input.conversationId,
      issueId: input.issueId,
      actorId: input.actorId,
      taskId: input.taskId,
      properties: redactTelemetryProperties(input.properties),
    };
  }

  private createDiagnosticEvent(input: DiagnosticEventInput): DiagnosticEvent {
    const base = this.createEvent({ ...input, category: "diagnostic" });
    return {
      ...base,
      category: "diagnostic",
      diagnostic: redactTelemetryValue(input.diagnostic) as unknown as DiagnosticDetails,
    };
  }

  private async write(events: TelemetryEvent[]): Promise<void> {
    if (!this.primary?.enabled) {
      await this.fallbackStore.appendBatch(events);
      return;
    }

    try {
      await this.primary.appendBatch(events);
      this.fallbackState.active = false;
    } catch (error) {
      const diagnostic = this.fallbackDiagnostic("write", error);
      await this.fallbackStore.appendBatch([...events, diagnostic]);
    }
  }

  private fallbackDiagnostic(action: string, error: unknown): DiagnosticEvent {
    const message = error instanceof Error ? error.message : String(error);
    const timestamp = this.now().toISOString();
    this.fallbackState = {
      active: true,
      count: this.fallbackState.count + 1,
      lastError: message,
      lastFallbackAt: timestamp,
    };
    return this.createDiagnosticEvent({
      name: "telemetry.remote_fallback",
      level: "warn",
      timestamp,
      diagnostic: {
        code: "REMOTE_STORE_FAILURE",
        component: "telemetry",
        message,
        recoverable: true,
      },
      properties: { action },
    });
  }
}

function normalizeTimestamp(timestamp: string | undefined, now: () => Date): string {
  if (!timestamp) {
    return now().toISOString();
  }
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? now().toISOString() : parsed.toISOString();
}

function emptyStats(): TelemetryStats {
  return {
    total: 0,
    byName: {},
    byCategory: {},
    byLevel: { debug: 0, info: 0, warn: 0, error: 0 },
  };
}

function uniqueEvents(events: TelemetryEvent[]): TelemetryEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

function mergeStats(left: TelemetryStats, right: TelemetryStats): TelemetryStats {
  return {
    total: left.total + right.total,
    byName: mergeCounts(left.byName, right.byName),
    byCategory: mergeCounts(left.byCategory, right.byCategory),
    byLevel: mergeCounts(left.byLevel, right.byLevel),
    firstTimestamp: [left.firstTimestamp, right.firstTimestamp].filter(Boolean).sort()[0],
    lastTimestamp: [left.lastTimestamp, right.lastTimestamp].filter(Boolean).sort().at(-1),
  };
}

function mergeCounts<T extends Record<string, number>>(left: T, right: T): T {
  const result = { ...left };
  for (const [key, count] of Object.entries(right)) {
    result[key as keyof T] = ((result[key] || 0) + count) as T[keyof T];
  }
  return result;
}
