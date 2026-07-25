import type { TelemetryEvent, TelemetryQuery, TelemetryStats } from "../../../../packages/shared/src/index.ts";

export interface TelemetryStore {
  readonly enabled: boolean;
  append(event: TelemetryEvent): Promise<void>;
  appendBatch(events: TelemetryEvent[]): Promise<void>;
  query(query?: TelemetryQuery): Promise<TelemetryEvent[]>;
  stats(query?: TelemetryQuery): Promise<TelemetryStats>;
}

function includes(values: string[] | undefined, value: string): boolean {
  return !values?.length || values.includes(value);
}

export function filterTelemetryEvents(events: TelemetryEvent[], query: TelemetryQuery = {}): TelemetryEvent[] {
  const from = query.from ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
  const to = query.to ? Date.parse(query.to) : Number.POSITIVE_INFINITY;
  const offset = Math.max(0, query.offset || 0);
  const limit = Math.max(0, query.limit ?? 100);

  return events
    .filter((event) => {
      const timestamp = Date.parse(event.timestamp);
      return timestamp >= from
        && timestamp <= to
        && includes(query.names, event.name)
        && includes(query.categories, event.category)
        && includes(query.levels, event.level)
        && (!query.source || event.source === query.source)
        && (!query.sessionId || event.sessionId === query.sessionId)
        && (!query.clientSessionId || event.clientSessionId === query.clientSessionId)
        && (!query.requestId || event.requestId === query.requestId)
        && (!query.conversationId || event.conversationId === query.conversationId)
        && (!query.issueId || event.issueId === query.issueId)
        && (!query.actorId || event.actorId === query.actorId)
        && (!query.taskId || event.taskId === query.taskId);
    })
    .sort((left, right) => {
      const difference = Date.parse(left.timestamp) - Date.parse(right.timestamp);
      return query.order === "asc" ? difference : -difference;
    })
    .slice(offset, offset + limit);
}

export function calculateTelemetryStats(events: TelemetryEvent[]): TelemetryStats {
  const stats: TelemetryStats = {
    total: events.length,
    byName: {},
    byCategory: {},
    byLevel: { debug: 0, info: 0, warn: 0, error: 0 },
  };

  for (const event of events) {
    stats.byName[event.name] = (stats.byName[event.name] || 0) + 1;
    stats.byCategory[event.category] = (stats.byCategory[event.category] || 0) + 1;
    stats.byLevel[event.level] += 1;
  }

  const timestamps = events.map((event) => event.timestamp).sort();
  stats.firstTimestamp = timestamps[0];
  stats.lastTimestamp = timestamps[timestamps.length - 1];
  return stats;
}
