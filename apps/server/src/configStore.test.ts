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
