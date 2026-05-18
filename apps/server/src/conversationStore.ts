import fs from "fs";
import path from "path";
import type { Conversation } from "../../../packages/shared/src/index.ts";

interface StoredConversations {
  conversations: Conversation[];
}

export class ConversationStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "conversations.json");
    fs.mkdirSync(dataDir, { recursive: true });
  }

  read(): StoredConversations {
    if (!fs.existsSync(this.filePath)) {
      const initial = { conversations: [] };
      this.write(initial);
      return initial;
    }

    return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as StoredConversations;
  }

  write(data: StoredConversations): void {
    fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`);
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
}
