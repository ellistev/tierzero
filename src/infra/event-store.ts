/**
 * SQLite-backed Event Store using Node.js built-in sqlite module.
 */
import { DatabaseSync } from "node:sqlite";
import type { StoredEvent } from "./interfaces";

export class ConcurrencyError extends Error {
  constructor(streamId: string, expected: number, actual: number) {
    super(`Concurrency error on stream "${streamId}": expected version ${expected}, actual ${actual}`);
    this.name = "ConcurrencyError";
  }
}

export class EventStore {
  private db: DatabaseSync;
  private subscribers: Array<(event: StoredEvent) => void> = [];

  constructor(dbPath: string = ":memory:") {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        global_position INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        UNIQUE(stream_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream_id);
    `);
  }

  appendToStream(streamId: string, events: { type: string; data: Record<string, unknown> }[], expectedVersion: number): void {
    const currentVersion = this.getStreamVersion(streamId);
    if (currentVersion !== expectedVersion) {
      throw new ConcurrencyError(streamId, expectedVersion, currentVersion);
    }

    const stmt = this.db.prepare(
      "INSERT INTO events (stream_id, version, type, data, timestamp) VALUES (?, ?, ?, ?, ?)"
    );

    const newEvents: StoredEvent[] = [];
    let version = expectedVersion;
    const now = new Date().toISOString();

    for (const event of events) {
      version++;
      stmt.run(streamId, version, event.type, JSON.stringify(event.data), now);
      // Get the last inserted rowid for global position
      const row = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
      newEvents.push({
        globalPosition: row.id,
        streamId,
        version,
        type: event.type,
        data: event.data,
        timestamp: now,
      });
    }

    // Notify subscribers
    for (const event of newEvents) {
      for (const sub of this.subscribers) {
        sub(event);
      }
    }
  }

  read(streamId: string): StoredEvent[] {
    const rows = this.db.prepare(
      "SELECT global_position, stream_id, version, type, data, timestamp FROM events WHERE stream_id = ? ORDER BY version"
    ).all(streamId) as Array<{ global_position: number; stream_id: string; version: number; type: string; data: string; timestamp: string }>;

    return rows.map((r) => ({
      globalPosition: r.global_position,
      streamId: r.stream_id,
      version: r.version,
      type: r.type,
      data: JSON.parse(r.data),
      timestamp: r.timestamp,
    }));
  }

  readAllBatch(afterPosition: number = 0, batchSize: number = 100): StoredEvent[] {
    const rows = this.db.prepare(
      "SELECT global_position, stream_id, version, type, data, timestamp FROM events WHERE global_position > ? ORDER BY global_position LIMIT ?"
    ).all(afterPosition, batchSize) as Array<{ global_position: number; stream_id: string; version: number; type: string; data: string; timestamp: string }>;

    return rows.map((r) => ({
      globalPosition: r.global_position,
      streamId: r.stream_id,
      version: r.version,
      type: r.type,
      data: JSON.parse(r.data),
      timestamp: r.timestamp,
    }));
  }

  subscribeToAll(handler: (event: StoredEvent) => void): () => void {
    this.subscribers.push(handler);
    return () => {
      const idx = this.subscribers.indexOf(handler);
      if (idx >= 0) this.subscribers.splice(idx, 1);
    };
  }

  private getStreamVersion(streamId: string): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(version), 0) as version FROM events WHERE stream_id = ?"
    ).get(streamId) as { version: number };
    return row.version;
  }

  close(): void {
    this.db.close();
  }
}
