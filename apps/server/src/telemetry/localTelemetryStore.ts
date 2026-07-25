import fs from "node:fs";
import path from "node:path";
import type { TelemetryEvent, TelemetryQuery, TelemetryStats } from "../../../../packages/shared/src/index.ts";
import { calculateTelemetryStats, filterTelemetryEvents, type TelemetryStore } from "./store.ts";

export interface LocalTelemetryStoreOptions {
  dataDir: string;
  fileName?: string;
  retentionDays?: number;
  maxEvents?: number;
  now?: () => Date;
}

export class LocalTelemetryStore implements TelemetryStore {
  readonly enabled = true;
  readonly filePath: string;
  private readonly retentionDays: number;
  private readonly maxEvents: number;
  private readonly now: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: LocalTelemetryStoreOptions | string) {
    const resolved = typeof options === "string" ? { dataDir: options } : options;
    this.filePath = path.join(resolved.dataDir, resolved.fileName || "telemetry.jsonl");
    this.retentionDays = Math.max(0, resolved.retentionDays ?? 30);
    this.maxEvents = Math.max(1, resolved.maxEvents ?? 50_000);
    this.now = resolved.now || (() => new Date());
    fs.mkdirSync(resolved.dataDir, { recursive: true });
  }

  async append(event: TelemetryEvent): Promise<void> {
    return this.appendBatch([event]);
  }

  async appendBatch(events: TelemetryEvent[]): Promise<void> {
    if (!events.length) {
      return;
    }

    const operation = this.writeQueue
      .catch(() => undefined)
      .then(() => this.writeAtomically(this.prune([...this.readFile(), ...events])));
    this.writeQueue = operation;
    return operation;
  }

  async query(query: TelemetryQuery = {}): Promise<TelemetryEvent[]> {
    await this.writeQueue.catch(() => undefined);
    return filterTelemetryEvents(this.prune(this.readFile()), query);
  }

  async stats(query: TelemetryQuery = {}): Promise<TelemetryStats> {
    await this.writeQueue.catch(() => undefined);
    const matches = filterTelemetryEvents(this.prune(this.readFile()), {
      ...query,
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    return calculateTelemetryStats(matches);
  }

  private readFile(): TelemetryEvent[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    return fs.readFileSync(this.filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as TelemetryEvent];
        } catch {
          return [];
        }
      });
  }

  private prune(events: TelemetryEvent[]): TelemetryEvent[] {
    const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1_000;
    return events
      .filter((event) => {
        const timestamp = Date.parse(event.timestamp);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      })
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      .slice(-this.maxEvents);
  }

  private writeAtomically(events: TelemetryEvent[]): void {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : "";

    try {
      fs.writeFileSync(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporaryPath, this.filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) {
        fs.rmSync(temporaryPath, { force: true });
      }
    }
  }
}
