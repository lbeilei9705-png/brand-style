import type { ModelConfig } from "../../../packages/shared/src/index.ts";

export interface RuntimeBuildInfo {
  version: string;
  commit: string;
  minimumClientVersion: string;
  node: string;
  startedAt: string;
}

const startedAt = new Date().toISOString();

export function getRuntimeBuildInfo(): RuntimeBuildInfo {
  return {
    version: process.env.BRAND_STYLE_VERSION || process.env.npm_package_version || "1.0.0",
    commit: process.env.BRAND_STYLE_BUILD_HASH || process.env.GITHUB_SHA || "unknown",
    minimumClientVersion: process.env.BRAND_STYLE_MIN_CLIENT_VERSION || "1.0.0",
    node: process.version,
    startedAt,
  };
}

export function getModelReadiness(models: ModelConfig[], allowMock = false): {
  ready: boolean;
  enabledImageModels: number;
  configuredImageModels: number;
  missingCredentialModelIds: string[];
} {
  const enabled = models.filter((model) => model.enabled && (model.purpose || "image") === "image");
  const configured = enabled.filter((model) => (allowMock && model.provider === "mock") || Boolean(model.apiKey));
  return {
    ready: configured.length > 0,
    enabledImageModels: enabled.length,
    configuredImageModels: configured.length,
    missingCredentialModelIds: enabled
      .filter((model) => model.provider !== "mock" && !model.apiKey)
      .map((model) => model.id),
  };
}
