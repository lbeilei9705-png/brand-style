import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddConversationMessageRequest } from "../../../packages/shared/src/index.ts";
import { ConfigStore } from "./configStore.ts";
import { ConversationGenerationService } from "./conversationGenerationService.ts";
import { ConversationStore } from "./conversationStore.ts";
import { TaskStore } from "./taskStore.ts";

test("parallel generation responses append without losing conversation messages", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-concurrency-"));

  try {
    const configStore = new ConfigStore(dataDir);
    const service = new ConversationGenerationService(
      new ConversationStore(dataDir),
      configStore,
      new TaskStore(),
    );
    const model = configStore.listModels().find((item) => item.id === "mock-preview");
    const agent = configStore.listAgents().find((item) => item.enabled);
    assert.ok(model);
    assert.ok(agent);

    const conversation = service.create({ modelId: model.id, agentId: agent.id });
    const request = (content: string): AddConversationMessageRequest => ({
      content,
      modelId: model.id,
      agentId: agent.id,
      inputType: "auto",
      selectionAssets: [],
      batchSize: 1,
      aspectRatio: "1:1",
      resolution: "1k",
      usePromptOrchestrator: false,
    });

    await Promise.all([
      service.addMessage(conversation.id, request("并发任务 A")),
      service.addMessage(conversation.id, request("并发任务 B")),
    ]);

    const updated = service.get(conversation.id);
    assert.ok(updated);
    assert.equal(updated.messages.length, 4);
    assert.equal(updated.taskIds.length, 2);
    assert.deepEqual(
      updated.messages.filter((message) => message.role === "user").map((message) => message.content).sort(),
      ["并发任务 A", "并发任务 B"],
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("member access only exposes conversations owned by that member", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-owner-"));
  try {
    const configStore = new ConfigStore(dataDir);
    const service = new ConversationGenerationService(
      new ConversationStore(dataDir),
      configStore,
      new TaskStore(),
    );
    const model = configStore.listModels().find((item) => item.id === "mock-preview");
    const agent = configStore.listAgents().find((item) => item.enabled);
    assert.ok(model);
    assert.ok(agent);

    const owned = service.create({ modelId: model.id, agentId: agent.id }, "member-a");
    const legacy = service.create({ modelId: model.id, agentId: agent.id });
    assert.deepEqual(service.list("member-a").map((item) => item.id), [owned.id]);
    assert.deepEqual(service.list("member-b"), []);
    assert.equal(service.get(owned.id, "member-b"), undefined);
    assert.equal(service.get(legacy.id, "member-a"), undefined);
    assert.equal(service.list().length, 2);
    assert.equal(service.delete(owned.id, "member-b"), false);

    await assert.rejects(
      service.addMessage(owned.id, {
        content: "越权请求",
        modelId: model.id,
        agentId: agent.id,
        inputType: "auto",
        selectionAssets: [],
        batchSize: 1,
        aspectRatio: "1:1",
        resolution: "1k",
        usePromptOrchestrator: false,
      }, undefined, "member-b"),
      /Conversation not found/,
    );
    assert.equal(service.delete(owned.id, "member-a"), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
