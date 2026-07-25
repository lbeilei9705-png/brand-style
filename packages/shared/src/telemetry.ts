export type TelemetryLevel = "debug" | "info" | "warn" | "error";

export type TelemetryValue =
  | string
  | number
  | boolean
  | null
  | TelemetryValue[]
  | { [key: string]: TelemetryValue };

export interface TelemetryEventInput {
  name: string;
  source?: string;
  category?: string;
  level?: TelemetryLevel;
  timestamp?: string;
  sessionId?: string;
  clientSessionId?: string;
  requestId?: string;
  conversationId?: string;
  issueId?: string;
  actorId?: string;
  taskId?: string;
  properties?: Record<string, unknown>;
}

export interface TelemetryEvent {
  id: string;
  name: string;
  source: string;
  category: string;
  level: TelemetryLevel;
  timestamp: string;
  sessionId?: string;
  clientSessionId?: string;
  requestId?: string;
  conversationId?: string;
  issueId?: string;
  actorId?: string;
  taskId?: string;
  properties: Record<string, TelemetryValue>;
}

export interface DiagnosticDetails {
  code: string;
  component: string;
  message?: string;
  stack?: string;
  recoverable?: boolean;
}

export interface DiagnosticEventInput extends Omit<TelemetryEventInput, "category"> {
  diagnostic: DiagnosticDetails;
}

export interface DiagnosticEvent extends TelemetryEvent {
  category: "diagnostic";
  diagnostic: DiagnosticDetails;
}

export interface TelemetryQuery {
  from?: string;
  to?: string;
  names?: string[];
  categories?: string[];
  levels?: TelemetryLevel[];
  source?: string;
  sessionId?: string;
  clientSessionId?: string;
  requestId?: string;
  conversationId?: string;
  issueId?: string;
  actorId?: string;
  taskId?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

export interface TelemetryStats {
  total: number;
  byName: Record<string, number>;
  byCategory: Record<string, number>;
  byLevel: Record<TelemetryLevel, number>;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export interface TelemetryFallbackState {
  active: boolean;
  count: number;
  lastError?: string;
  lastFallbackAt?: string;
}
