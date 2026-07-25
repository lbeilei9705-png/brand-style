import type { TelemetryConfig } from "../config.ts";
import { LocalTelemetryStore } from "./localTelemetryStore.ts";
import { SupabaseTelemetryStore } from "./supabaseTelemetryStore.ts";
import { TelemetryService } from "./telemetryService.ts";

export * from "./localTelemetryStore.ts";
export * from "./normalizeClientTelemetry.ts";
export * from "./redact.ts";
export * from "./store.ts";
export * from "./supabaseTelemetryStore.ts";
export * from "./telemetryService.ts";

export function createTelemetryService(config: TelemetryConfig): TelemetryService {
  const local = new LocalTelemetryStore({
    dataDir: config.localDir,
    retentionDays: config.retentionDays,
    maxEvents: config.maxEvents,
  });
  const remote = config.store === "supabase" && config.supabase
    ? new SupabaseTelemetryStore({
      url: config.supabase.url,
      serviceRoleKey: config.supabase.serviceRoleKey,
      tableName: config.supabase.tableName,
    })
    : undefined;

  return new TelemetryService({
    enabled: config.enabled,
    primary: remote,
    fallback: local,
  });
}
