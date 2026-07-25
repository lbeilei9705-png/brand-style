import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationTask } from "../../../packages/shared/src/index.ts";
import { TaskService } from "./taskService.ts";
import { TaskStore } from "./taskStore.ts";

function createTask(): GenerationTask {
  return {
    id: "task_test",
    status: "completed",
    target: "web",
    inputAsset: {
      id: "input",
      name: "input",
      filename: "input.png",
      mimeType: "image/png",
      sizeBytes: 1,
    },
    stylePreset: {
      id: "style",
      name: "style",
      description: "style",
      stylePrompt: "style",
      materialPrompt: "material",
      lightingPrompt: "lighting",
      negativeRules: [],
      version: "1",
    },
    constraints: {
      preserveStructure: true,
      styleLock: true,
      transparentBackground: true,
      fidelityLevel: "balanced",
      variationStrength: "medium",
      batchSize: 2,
      aspectRatio: "1:1",
      resolution: "1k",
    },
    preprocess: {
      normalized: true,
      actions: [],
    },
    prompt: {
      positive: "positive",
      negative: "negative",
      template: "template",
      referencePack: {
        structureAnchors: [],
        styleAnchors: [],
      },
    },
    results: [
      {
        id: "result_1",
        taskId: "task_test",
        imageUrl: "data:image/png;base64,AA==",
        width: 1,
        height: 1,
        rank: 1,
        selected: true,
        meta: { provider: "mock", seed: 1 },
      },
      {
        id: "result_2",
        taskId: "task_test",
        imageUrl: "data:image/png;base64,AA==",
        width: 1,
        height: 1,
        rank: 2,
        selected: false,
        meta: { provider: "mock", seed: 2 },
      },
    ],
    selectedResultId: "result_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("selectResult rejects an unknown result without mutating the task", () => {
  const store = new TaskStore();
  const original = store.save(createTask());

  assert.equal(store.selectResult(original.id, "result_missing"), undefined);
  assert.deepEqual(store.get(original.id), original);
});

test("selectResult selects a result that belongs to the task", () => {
  const store = new TaskStore();
  store.save(createTask());

  const selected = store.selectResult("task_test", "result_2");

  assert.equal(selected?.selectedResultId, "result_2");
  assert.deepEqual(selected?.results.map((result) => result.selected), [false, true]);
});

test("createTask uses a UUID-backed task id", async () => {
  const store = new TaskStore();
  const service = new TaskService(store, {
    async generate() {
      return [{
        id: "generated",
        imageUrl: "data:image/png;base64,AA==",
        width: 1,
        height: 1,
        seed: 1,
        provider: "mock",
      }];
    },
  });

  const response = await service.createTask({
    inputType: "auto",
    stylePresetId: "",
    source: "web_upload",
    filename: "input.png",
    mimeType: "image/png",
    sizeBytes: 1,
    constraints: {
      preserveStructure: true,
      styleLock: true,
      transparentBackground: true,
      fidelityLevel: "balanced",
      variationStrength: "medium",
      batchSize: 1,
      aspectRatio: "1:1",
      resolution: "1k",
    },
    target: "web",
  });

  assert.match(
    response.taskId,
    /^task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
