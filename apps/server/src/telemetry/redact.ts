import type { TelemetryValue } from "../../../../packages/shared/src/index.ts";

export const REDACTED = "[REDACTED]";
export const REDACTED_SIGNED_URL = "[REDACTED_SIGNED_URL]";

const SENSITIVE_KEY_PARTS = [
  "token",
  "apikey",
  "authorization",
  "invite",
  "prompt",
  "content",
  "dataurl",
  "base64",
  "signedurl",
  "message",
  "stack",
];
const SIGNATURE_PARAM = /(?:[?&](?:x-amz-signature|signature|sig|token|x-oss-signature|ossaccesskeyid)=)/i;
const DATA_URL = /^data:[^;,]+;base64,/i;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]{128,}={0,2}$/;
const DIAGNOSTIC_SECRET_KEY = /(token|api.?key|authorization|cookie|secret|invite.?code|service.?role)/i;

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function redactString(value: string): string {
  if (DATA_URL.test(value) || BASE64_PAYLOAD.test(value)) {
    return REDACTED;
  }

  if (/^https?:\/\//i.test(value) && SIGNATURE_PARAM.test(value)) {
    return REDACTED_SIGNED_URL;
  }

  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED]");
}

function visit(value: unknown, seen: WeakSet<object>): TelemetryValue {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value as object)) {
    return "[CIRCULAR]";
  }

  seen.add(value as object);
  if (Array.isArray(value)) {
    const result = value.map((item) => visit(item, seen));
    seen.delete(value);
    return result;
  }

  const result: Record<string, TelemetryValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : visit(item, seen);
  }
  seen.delete(value as object);
  return result;
}

export function redactTelemetryValue(value: unknown): TelemetryValue {
  return visit(value, new WeakSet());
}

export function redactTelemetryProperties(properties?: Record<string, unknown>): Record<string, TelemetryValue> {
  return (redactTelemetryValue(properties || {}) as Record<string, TelemetryValue>);
}

export function redactDiagnosticContext(value: unknown): TelemetryValue {
  return visitDiagnostic(value, new WeakSet());
}

function visitDiagnostic(value: unknown, seen: WeakSet<object>): TelemetryValue {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object" || value === undefined) return String(value);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => visitDiagnostic(item, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, TelemetryValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = DIAGNOSTIC_SECRET_KEY.test(key) ? REDACTED : visitDiagnostic(item, seen);
  }
  seen.delete(value);
  return result;
}
