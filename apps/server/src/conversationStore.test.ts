import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Conversation } from "../../../packages/shared/src/index.ts";
import { compactLargeConversationStore, ConversationStore, createConversationStore } from "./conversationStore.ts";

function makeConversation(assetDataUrl: string): Conversation {
  const timestamp = new Date().toISOString();
  return {
    id: "conv_test",
    title: "参考图测试",
    modelId: "mock",
    agentId: "",
    messages: [{
      id: "msg_test",
      role: "user",
      content: "保留中文提示词和文本中的 assetDataUrl 字样",
      createdAt: timestamp,
      selectionAssets: [{
        id: "asset_test",
        name: "参考图",
        filename: "reference.png",
        mimeType: "image/png",
        sizeBytes: assetDataUrl.length,
        assetDataUrl,
        width: 1024,
        height: 1024,
      }],
    }],
    taskIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("conversation persistence keeps reference metadata without base64 data", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-conversations-"));

  try {
    const store = new ConversationStore(dataDir);
    const saved = store.save(makeConversation(`data:image/png;base64,${"A".repeat(10_000)}`));
    const savedAsset = saved.messages[0].selectionAssets?.[0];
    const raw = fs.readFileSync(path.join(dataDir, "conversations.json"), "utf8");

    assert.equal(savedAsset?.filename, "reference.png");
    assert.equal(savedAsset?.assetDataUrl, undefined);
    assert.equal(raw.includes("base64"), false);
    assert.ok(raw.length < 2_000);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("large legacy conversation files are compacted before JSON parsing", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-conversations-"));

  try {
    const filePath = path.join(dataDir, "conversations.json");
    fs.writeFileSync(filePath, JSON.stringify({
      conversations: [makeConversation(`data:image/png;base64,${"B".repeat(200_000)}`)],
    }));

    const result = await compactLargeConversationStore(dataDir, 1, 0);
    assert.equal(result.compacted, true);
    assert.equal(result.strippedAssets, 1);
    assert.equal(Boolean(result.backupPath && fs.existsSync(result.backupPath)), true);

    const store = new ConversationStore(dataDir);
    const conversations = store.list();
    const raw = fs.readFileSync(filePath, "utf8");
    assert.equal(conversations[0].messages[0].content, "保留中文提示词和文本中的 assetDataUrl 字样");
    assert.equal(conversations[0].messages[0].selectionAssets?.[0].assetDataUrl, undefined);
    assert.equal(raw.includes("base64"), false);
    assert.ok(raw.length < 2_000);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("invalid large legacy files are preserved and skipped instead of blocking startup", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-conversations-"));

  try {
    const filePath = path.join(dataDir, "conversations.json");
    fs.writeFileSync(filePath, `{"conversations":[{"messages":[{"selectionAssets":[{"assetDataUrl":"data:image/png;base64,${"C".repeat(100_000)}`);

    const store = await createConversationStore(dataDir, 30, 1, 1_000, 1);
    assert.deepEqual(store.list(), []);
    const names = fs.readdirSync(dataDir);
    assert.equal(fs.readFileSync(filePath, "utf8").includes("base64"), true);
    assert.throws(() => store.save(makeConversation("data:image/png;base64,AA==")), /拒绝覆盖原文件/);
    assert.equal(names.some((name) => name.endsWith(".compact.tmp") || name.endsWith(".compact.lock")), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("an active compaction lock prevents a competing migration", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-conversations-"));

  try {
    const filePath = path.join(dataDir, "conversations.json");
    fs.writeFileSync(filePath, JSON.stringify({
      conversations: [makeConversation(`data:image/png;base64,${"D".repeat(10_000)}`)],
    }));
    fs.writeFileSync(`${filePath}.compact.lock`, "other process");

    const store = await createConversationStore(dataDir, 30, 1, 0, 1);
    assert.deepEqual(store.list(), []);
    assert.equal(fs.readFileSync(filePath, "utf8").includes("base64"), true);
    assert.throws(() => store.save(makeConversation("data:image/png;base64,AA==")), /拒绝覆盖原文件/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("large text-only stores remain readable below the hard safety limit", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-conversations-"));

  try {
    const filePath = path.join(dataDir, "conversations.json");
    const conversation = makeConversation("unused");
    conversation.messages[0].selectionAssets = undefined;
    conversation.messages[0].content = "正常历史文字".repeat(2_000);
    fs.writeFileSync(filePath, JSON.stringify({ conversations: [conversation] }));

    const store = await createConversationStore(dataDir, 30, 1, 0, 1_000_000);
    assert.equal(store.list().length, 1);
    assert.doesNotThrow(() => store.save(conversation));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("read returns sanitized history when maintenance write-back fails", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-conversations-"));

  try {
    const filePath = path.join(dataDir, "conversations.json");
    fs.writeFileSync(filePath, JSON.stringify({
      conversations: [makeConversation("data:image/png;base64,AA==")],
    }));
    const store = new ConversationStore(dataDir);
    store.write = () => {
      throw new Error("ENOSPC");
    };

    const conversations = store.list();
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].messages[0].selectionAssets?.[0].assetDataUrl, undefined);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
