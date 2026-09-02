import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigStore, type StoredConfig } from "./configStore.ts";
import type { RemoteConfigStore } from "./storage/supabaseConfigStore.ts";

function emptyConfig(modelName: string): StoredConfig {
  return {
    models: [{
      id: modelName,
      name: modelName,
      provider: "mock",
      model: "mock-preview",
      purpose: "image",
      quality: "auto",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    agents: [],
    materials: [],
    colorPalettes: [],
    shapeArchitectures: [],
    operationScenarios: [],
    scenarioAgents: [],
    scenarioAgentCases: [],
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for remote writes.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("remote config writes are serialized in call order", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-config-"));
  const writes: string[] = [];
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const remoteStore: RemoteConfigStore<StoredConfig> = {
    enabled: true,
    async read() {
      return undefined;
    },
    async write(config) {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 15));
      writes.push(config.models[0]?.name || "");
      activeWrites -= 1;
    },
  };

  try {
    const store = new ConfigStore(dataDir, remoteStore);
    store.write(emptyConfig("first"));
    store.write(emptyConfig("second"));
    await waitFor(() => writes.length === 2);

    assert.equal(maxActiveWrites, 1);
    assert.deepEqual(writes, ["first", "second"]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("built-in scenario agents cannot be deleted", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-config-"));

  try {
    const store = new ConfigStore(dataDir);

    assert.equal(store.deleteScenarioAgent("finance-app-icon-planner"), false);
    assert.equal(store.listScenarioAgents().some((agent) => agent.id === "finance-app-icon-planner"), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("model API keys are never persisted locally or remotely", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-config-"));
  let remoteConfig: StoredConfig | undefined;
  const remoteStore: RemoteConfigStore<StoredConfig> = {
    enabled: true,
    async read() {
      return undefined;
    },
    async write(config) {
      remoteConfig = config;
    },
  };

  try {
    const config = emptyConfig("secure-model");
    config.models[0].apiKey = "must-not-be-stored";
    config.models[0].apiKeyEnv = "SECURE_MODEL_API_KEY";
    const store = new ConfigStore(dataDir, remoteStore);
    store.write(config);
    await waitFor(() => Boolean(remoteConfig));

    const local = fs.readFileSync(path.join(dataDir, "config.json"), "utf8");
    assert.equal(local.includes("must-not-be-stored"), false);
    assert.equal(remoteConfig?.models[0].apiKey, undefined);
    assert.equal(remoteConfig?.models[0].apiKeyEnv, "SECURE_MODEL_API_KEY");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("initial remote sync strips environment secrets and rejects system secret names", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-config-"));
  const originalToken = process.env.GOOGLE_API_TOKEN;
  let remoteConfig: StoredConfig | undefined;
  const remoteStore: RemoteConfigStore<StoredConfig> = {
    enabled: true,
    async read() {
      return undefined;
    },
    async write(config) {
      remoteConfig = config;
    },
  };

  try {
    process.env.GOOGLE_API_TOKEN = "environment-secret";
    const store = new ConfigStore(dataDir, remoteStore);
    await store.syncFromRemote();
    assert.equal(remoteConfig?.models.some((model) => Boolean(model.apiKey)), false);
    assert.throws(() => store.upsertModel({
      name: "unsafe",
      provider: "fintopia",
      model: "unsafe",
      apiKeyEnv: "SUPABASE_SERVICE_ROLE_API_KEY",
    }), /环境变量名无效/);
  } finally {
    if (originalToken === undefined) delete process.env.GOOGLE_API_TOKEN;
    else process.env.GOOGLE_API_TOKEN = originalToken;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("local legacy secrets block configuration writes until environment migration", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-config-"));
  const config = emptyConfig("legacy-model");
  config.models[0].provider = "fintopia";
  config.models[0].apiKey = "legacy-secret";
  fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(config));

  try {
    const store = new ConfigStore(dataDir);
    assert.throws(() => store.upsertModel({
      ...config.models[0],
      name: "updated",
    }), /尚未迁移到环境变量/);
    assert.equal(fs.readFileSync(path.join(dataDir, "config.json"), "utf8").includes("legacy-secret"), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
