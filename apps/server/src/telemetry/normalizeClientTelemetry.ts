import type { TelemetryEventInput, TelemetryLevel } from "../../../../packages/shared/src/index.ts";

export const MAX_CLIENT_TELEMETRY_BATCH = 100;
export const MAX_CLIENT_TELEMETRY_NAME_LENGTH = 100;

export const DEFAULT_CLIENT_TELEMETRY_EVENT_NAMES = new Set([
  "client_error",
  "diagnostics_export",
  "diagnostics_copy",
  "selection_start",
  "selection_success",
  "selection_fail",
  "generation_start",
  "generation_success",
  "generation_abort_requested",
  "generation_abort",
  "scenario_complete_start",
  "scenario_complete_success",
  "scenario_complete_abort",
  "result_download_success",
  "result_download_fail",
  "result_insert_start",
  "result_insert_success",
  "result_insert_fail",
  "result_drag_start",
  "result_drop_start",
  "result_drop_success",
  "result_drop_fail",
  "config_load_start",
  "config_load_success",
  "config_load_fail",
  "login_start",
  "login_success",
  "login_fail",
]);

export interface ClientTelemetryContext {
  source: string;
  sessionId?: string;
  clientSessionId?: string;
  requestId?: string;
  conversationId?: string;
  issueId?: string;
  actorId?: string;
  taskId?: string;
  allowedEventNames?: ReadonlySet<string>;
}

export function normalizeClientTelemetryEvents(
  raw: unknown,
  context: ClientTelemetryContext,
): TelemetryEventInput[] {
  if (!Array.isArray(raw)) {
    throw new TypeError("客户端遥测 events 必须是数组");
  }
  if (raw.length > MAX_CLIENT_TELEMETRY_BATCH) {
    throw new RangeError(`客户端遥测单批不能超过 ${MAX_CLIENT_TELEMETRY_BATCH} 条`);
  }

  const allowedNames = context.allowedEventNames || DEFAULT_CLIENT_TELEMETRY_EVENT_NAMES;
  return raw.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const name = stringValue(item.name, MAX_CLIENT_TELEMETRY_NAME_LENGTH);
    if (!name || !allowedNames.has(name)) {
      return [];
    }

    const metadata = isRecord(item.metadata) ? { ...item.metadata } : {};
    const clientEventId = stringValue(item.eventId, 200);
    const properties: Record<string, unknown> = {
      ...metadata,
      ...(clientEventId ? { clientEventId } : {}),
    };

    return [{
      name,
      source: stringValue(context.source, 50) || "client",
      category: "client",
      level: telemetryLevel(item.level, name),
      timestamp: stringValue(item.at, 100),
      sessionId: associationId(context.sessionId, item.sessionId, metadata.sessionId),
      clientSessionId: associationId(context.clientSessionId, item.clientSessionId, metadata.clientSessionId),
      requestId: associationId(context.requestId, item.requestId, metadata.requestId),
      conversationId: associationId(context.conversationId, item.conversationId, metadata.conversationId),
      issueId: associationId(context.issueId, item.issueId, metadata.issueId),
      actorId: associationId(context.actorId),
      taskId: associationId(context.taskId, item.taskId, metadata.taskId),
      properties,
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function associationId(...values: unknown[]): string | undefined {
  for (const value of values) {
    const id = stringValue(value, 200);
    if (id) {
      return id;
    }
  }
  return undefined;
}

function telemetryLevel(value: unknown, name: string): TelemetryLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return name === "client_error" || name.endsWith("_fail") ? "error" : "info";
}
