import fs from "fs";
import path from "path";
import { StringDecoder } from "node:string_decoder";
import type { Conversation } from "../../../packages/shared/src/index.ts";

interface StoredConversations {
  conversations: Conversation[];
}

const EMPTY_STORE: StoredConversations = { conversations: [] };
const LARGE_STORE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_READABLE_STORE_BYTES = 128 * 1024 * 1024;
const STALE_COMPACTION_MS = 5 * 60 * 1_000;
const EMBEDDED_ASSET_KEYS = new Set(["assetDataUrl", "dataUrl"]);

function stripEmbeddedAssets(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      selectionAssets: message.selectionAssets?.map((asset) => {
        const { assetDataUrl: _assetDataUrl, ...metadata } = asset;
        delete (metadata as Record<string, unknown>).dataUrl;
        return metadata;
      }),
    })),
  };
}

function containsEmbeddedAssets(data: StoredConversations): boolean {
  return data.conversations.some((conversation) => (
    conversation.messages.some((message) => (
      message.selectionAssets?.some((asset) => (
        Object.hasOwn(asset, "assetDataUrl") || Object.hasOwn(asset, "dataUrl")
      )) ?? false
    ))
  ));
}

function sanitizeStore(data: StoredConversations): StoredConversations {
  return {
    conversations: data.conversations.map(stripEmbeddedAssets),
  };
}

function removeStaleCompactionFiles(dataDir: string, filePath: string): void {
  const prefix = `${path.basename(filePath)}.`;
  let names: string[];
  try {
    names = fs.readdirSync(dataDir);
  } catch {
    return;
  }
  for (const name of names) {
    const candidate = path.join(dataDir, name);
    const isCompactionFile = (name.startsWith(prefix) && name.endsWith(".compact.tmp"))
      || name === `${path.basename(filePath)}.compact.lock`;
    if (!isCompactionFile) {
      continue;
    }
    try {
      if (Date.now() - fs.statSync(candidate).mtimeMs >= STALE_COMPACTION_MS) {
        fs.unlinkSync(candidate);
      }
    } catch {
      // Another process may have completed cleanup.
    }
  }
}

function isOversizedFile(filePath: string, minimumBytes: number): boolean {
  try {
    return fs.statSync(filePath).size >= minimumBytes;
  } catch {
    return false;
  }
}

function removeDeadCompactionLock(lockPath: string): boolean {
  try {
    const ownerPid = Number(fs.readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
      return false;
    }
    process.kill(ownerPid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      return false;
    }
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    }
  }
}

function rewriteEmbeddedJsonStrings(sourcePath: string, targetPath: string): number {
  const input = fs.openSync(sourcePath, "r");
  let output: number | undefined;
  const decoder = new StringDecoder("utf8");
  let state: "normal" | "string" | "awaitValue" | "skipValue" = "normal";
  let candidate: string | undefined;
  let escaped = false;
  let matchedKey = false;
  let stripped = 0;
  let pending = "";

  const writeAll = (value: string) => {
    if (output === undefined) {
      throw new Error("Conversation compaction output is not open.");
    }
    const buffer = Buffer.from(value);
    let offset = 0;
    while (offset < buffer.length) {
      offset += fs.writeSync(output, buffer, offset, buffer.length - offset);
    }
  };

  const append = (value: string) => {
    pending += value;
    if (pending.length >= 64 * 1024) {
      writeAll(pending);
      pending = "";
    }
  };

  const processNormal = (character: string) => {
    if (matchedKey) {
      if (/\s/.test(character)) {
        append(character);
        return;
      }
      if (character === ":") {
        append(character);
        matchedKey = false;
        state = "awaitValue";
        return;
      }
      matchedKey = false;
    }

    append(character);
    if (character === "\"") {
      state = "string";
      candidate = "";
      escaped = false;
    }
  };

  const processText = (text: string) => {
    for (const character of text) {
      if (state === "skipValue") {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          state = "normal";
        }
        continue;
      }

      if (state === "awaitValue") {
        if (/\s/.test(character)) {
          append(character);
        } else if (character === "\"") {
          append("null");
          stripped += 1;
          escaped = false;
          state = "skipValue";
        } else {
          state = "normal";
          processNormal(character);
        }
        continue;
      }

      if (state === "string") {
        append(character);
        if (escaped) {
          escaped = false;
          candidate = undefined;
        } else if (character === "\\") {
          escaped = true;
          candidate = undefined;
        } else if (character === "\"") {
          matchedKey = candidate !== undefined && EMBEDDED_ASSET_KEYS.has(candidate);
          state = "normal";
        } else if (candidate !== undefined) {
          candidate = candidate.length < 32 ? candidate + character : undefined;
        }
        continue;
      }

      processNormal(character);
    }
  };

  try {
    output = fs.openSync(targetPath, "w", 0o600);
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(input, chunk, 0, chunk.length, null)) > 0) {
      processText(decoder.write(chunk.subarray(0, bytesRead)));
    }
    processText(decoder.end());
    if (pending) {
      writeAll(pending);
    }
  } finally {
    fs.closeSync(input);
    if (output !== undefined) {
      fs.closeSync(output);
    }
  }

  return stripped;
}

export async function compactLargeConversationStore(
  dataDir: string,
  minimumBytes = LARGE_STORE_BYTES,
  lockWaitMs = 1_000,
): Promise<{
  compacted: boolean;
  strippedAssets: number;
  backupPath?: string;
}> {
  const filePath = path.join(dataDir, "conversations.json");
  if (!isOversizedFile(filePath, minimumBytes)) {
    return { compacted: false, strippedAssets: 0 };
  }

  removeStaleCompactionFiles(dataDir, filePath);
  const lockPath = `${filePath}.compact.lock`;
  const lockDeadline = Date.now() + lockWaitMs;
  let lock: number | undefined;
  while (lock === undefined) {
    try {
      lock = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (removeDeadCompactionLock(lockPath)) {
        continue;
      }
      if (Date.now() >= lockDeadline) {
        return { compacted: false, strippedAssets: 0 };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!isOversizedFile(filePath, minimumBytes)) {
        return { compacted: false, strippedAssets: 0 };
      }
    }
  }
  const tempPath = `${filePath}.${process.pid}.compact.tmp`;
  try {
    fs.writeSync(lock, String(process.pid));
    const strippedAssets = rewriteEmbeddedJsonStrings(filePath, tempPath);
    if (!strippedAssets) {
      fs.unlinkSync(tempPath);
      return { compacted: false, strippedAssets: 0 };
    }

    const parsed = JSON.parse(fs.readFileSync(tempPath, "utf8")) as StoredConversations;
    if (!Array.isArray(parsed?.conversations)) {
      throw new Error("Compacted conversations.json has an invalid structure.");
    }

    const backupPath = `${filePath}.embedded-assets.${Date.now()}.bak`;
    fs.renameSync(filePath, backupPath);
    try {
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      fs.renameSync(backupPath, filePath);
      throw error;
    }

    return { compacted: true, strippedAssets, backupPath };
  } finally {
    try {
      fs.closeSync(lock);
    } catch {
      // Descriptor cleanup is best-effort.
    }
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Temporary file cleanup must not mask the original result.
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Lock cleanup is best-effort after the file operation has completed.
    }
  }
}

export class ConversationStore {
  private readonly filePath: string;
  private readonly retentionMs: number;
  private readonly maximumReadableBytes?: number;
  private oversizedWarningLogged = false;
  private maintenanceWarningLogged = false;

  constructor(dataDir: string, retentionDays = 30, maximumReadableBytes?: number) {
    this.filePath = path.join(dataDir, "conversations.json");
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1_000;
    this.maximumReadableBytes = maximumReadableBytes;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  get degraded(): boolean {
    return Boolean(
      this.maximumReadableBytes
      && isOversizedFile(this.filePath, this.maximumReadableBytes),
    );
  }

  read(): StoredConversations {
    if (!fs.existsSync(this.filePath)) {
      this.write(EMPTY_STORE);
      return { conversations: [] };
    }

    if (this.maximumReadableBytes && isOversizedFile(this.filePath, this.maximumReadableBytes)) {
      if (!this.oversizedWarningLogged) {
        console.error(`历史会话文件仍超过 ${this.maximumReadableBytes} 字节，已跳过读取以保护服务进程。`);
        this.oversizedWarningLogged = true;
      }
      return { conversations: [] };
    }

    let data: StoredConversations;

    try {
      data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as StoredConversations;
    } catch (error) {
      const backupPath = `${this.filePath}.corrupt.${Date.now()}`;
      try {
        fs.renameSync(this.filePath, backupPath);
      } catch {
        // If rename fails, still recover with an empty store so the server can boot.
      }

      console.error(
        `conversations.json 损坏，已备份为 ${path.basename(backupPath)} 并重置为空：`,
        error instanceof Error ? error.message : error,
      );
      this.write(EMPTY_STORE);
      return { conversations: [] };
    }

    if (!Array.isArray(data?.conversations)) {
      this.write(EMPTY_STORE);
      return { conversations: [] };
    }

    const cutoff = Date.now() - this.retentionMs;
    const hadEmbeddedAssets = containsEmbeddedAssets(data);
    const conversations = sanitizeStore(data).conversations.filter((conversation) => {
      const updatedAt = Date.parse(conversation.updatedAt);
      return Number.isNaN(updatedAt) || updatedAt >= cutoff;
    });

    if (hadEmbeddedAssets || conversations.length !== data.conversations.length) {
      try {
        this.write({ conversations });
      } catch (error) {
        if (!this.maintenanceWarningLogged) {
          console.error("历史会话已在内存中完成清理，但暂时无法写回磁盘：", error);
          this.maintenanceWarningLogged = true;
        }
      }
    }

    return { conversations };
  }

  write(data: StoredConversations): void {
    if (this.maximumReadableBytes && isOversizedFile(this.filePath, this.maximumReadableBytes)) {
      throw new Error("历史会话文件尚未完成瘦身，已拒绝覆盖原文件。");
    }
    const payload = `${JSON.stringify(sanitizeStore(data), null, 2)}\n`;
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      fs.writeFileSync(tempPath, payload, { mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Best-effort cleanup of the temp file.
      }
      throw error;
    }
  }

  list(): Conversation[] {
    return this.read().conversations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(conversationId: string): Conversation | undefined {
    return this.read().conversations.find((conversation) => conversation.id === conversationId);
  }

  save(conversation: Conversation): Conversation {
    const data = this.read();
    const sanitizedConversation = stripEmbeddedAssets(conversation);
    const exists = data.conversations.some((item) => item.id === sanitizedConversation.id);
    data.conversations = exists
      ? data.conversations.map((item) => (item.id === sanitizedConversation.id ? sanitizedConversation : item))
      : [...data.conversations, sanitizedConversation];
    this.write(data);
    return sanitizedConversation;
  }

  delete(conversationId: string): boolean {
    const data = this.read();
    const conversations = data.conversations.filter((conversation) => conversation.id !== conversationId);

    if (conversations.length === data.conversations.length) {
      return false;
    }

    this.write({ conversations });
    return true;
  }
}

export async function createConversationStore(
  dataDir: string,
  retentionDays = 30,
  minimumCompactionBytes = LARGE_STORE_BYTES,
  lockWaitMs = 1_000,
  maximumReadableBytes = MAXIMUM_READABLE_STORE_BYTES,
): Promise<ConversationStore> {
  let compaction: Awaited<ReturnType<typeof compactLargeConversationStore>>;
  try {
    compaction = await compactLargeConversationStore(dataDir, minimumCompactionBytes, lockWaitMs);
  } catch (error) {
    console.error("历史会话瘦身失败，已保护原文件并跳过读取：", error);
    return new ConversationStore(dataDir, retentionDays, maximumReadableBytes);
  }
  if (compaction.compacted) {
    console.warn(
      `历史会话已移除 ${compaction.strippedAssets} 个内嵌图片，原文件备份为 ${compaction.backupPath}`,
    );
  }
  const filePath = path.join(dataDir, "conversations.json");
  if (isOversizedFile(filePath, maximumReadableBytes)) {
    console.error("历史会话文件仍然过大，已跳过读取；请检查压缩锁或手动清理备份。");
    return new ConversationStore(dataDir, retentionDays, maximumReadableBytes);
  }
  return new ConversationStore(dataDir, retentionDays);
}
