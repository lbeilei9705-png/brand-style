import type http from "http";
import type { ModelConfig } from "../../../packages/shared/src/index.ts";
import type { AppConfig } from "./config.ts";
import { sendJson } from "./http/response.ts";
import { getModelReadiness, getRuntimeBuildInfo } from "./runtimeInfo.ts";
import { getServerSecurityStatus } from "./serverHttp.ts";

export function createHealthResponse(input: {
  appConfig: AppConfig;
  models: ModelConfig[];
  remoteConfigEnabled: boolean;
  ossEnabled: boolean;
  conversationStorageReady: boolean;
  includeDetails?: boolean;
}): Record<string, unknown> {
  const modelReadiness = getModelReadiness(input.models, input.appConfig.imageProvider === "mock");
  const security = getServerSecurityStatus();
  const build = getRuntimeBuildInfo();
  const response: Record<string, unknown> = {
    ok: true,
    ready: modelReadiness.ready && security.ready && input.conversationStorageReady,
    name: "3D Icon Style Engine",
    build: {
      version: build.version,
      minimumClientVersion: build.minimumClientVersion,
    },
    uptimeSeconds: Math.floor(process.uptime()),
  };
  if (!input.includeDetails) return response;
  return {
    ...response,
    build,
    provider: input.appConfig.imageProvider,
    storage: {
      supabase: input.remoteConfigEnabled,
      oss: input.ossEnabled,
      telemetry: input.appConfig.telemetry.store,
      conversations: input.conversationStorageReady ? "ready" : "degraded",
    },
    security,
    models: modelReadiness,
  };
}

export function sendHealthResponse(
  res: http.ServerResponse,
  appConfig: AppConfig,
  models: ModelConfig[],
  remoteConfigEnabled: boolean,
  ossEnabled: boolean,
  conversationStorageReady: boolean,
  includeDetails = false,
): void {
  sendJson(res, 200, createHealthResponse({
    appConfig,
    models,
    remoteConfigEnabled,
    ossEnabled,
    conversationStorageReady,
    includeDetails,
  }));
}
