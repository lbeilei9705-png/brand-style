import fs from "fs";
import path from "path";
import type { Conversation } from "../../../packages/shared/src/index.ts";

interface StoredConversations {
  conversations: Conversation[];
}

const EMPTY_STORE: StoredConversations = { conversations: [] };

export class ConversationStore {
  private readonly filePath: string;
  private readonly retentionMs: number;

  constructor(dataDir: string, retentionDays = 30) {
    this.filePath = path.join(dataDir, "conversations.json");
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1_000;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  read(): StoredConversations {
    if (!fs.existsSync(this.filePath)) {
      this.write(EMPTY_STORE);
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
    const conversations = data.conversations.filter((conversation) => {
      const updatedAt = Date.parse(conversation.updatedAt);
      return Number.isNaN(updatedAt) || updatedAt >= cutoff;
    });

    if (conversations.length !== data.conversations.length) {
      this.write({ conversations });
    }

    return { conversations };
  }

  write(data: StoredConversations): void {
    const payload = `${JSON.stringify(data, null, 2)}\n`;
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      fs.writeFileSync(tempPath, payload);
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
    const exists = data.conversations.some((item) => item.id === conversation.id);
    data.conversations = exists
      ? data.conversations.map((item) => (item.id === conversation.id ? conversation : item))
      : [...data.conversations, conversation];
    this.write(data);
    return conversation;
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
