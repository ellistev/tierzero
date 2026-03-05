/**
 * Read Model infrastructure - SQLite projections with checkpoint support.
 */
import { DatabaseSync } from "node:sqlite";
import type { StoredEvent, ReadModelConfig, ReadModelHandler, ReadModelRepo, ReadModelDefinition } from "./interfaces";
import type { EventStore } from "./event-store";

export class ReadRepository implements ReadModelRepo {
  private db: DatabaseSync;
  private config: ReadModelConfig;

  constructor(db: DatabaseSync, config: ReadModelConfig) {
    this.db = db;
    this.config = config;
    this.ensureTable();
  }

  private ensureTable(): void {
    const columns = Object.entries(this.config.schema)
      .map(([col, type]) => `${col} ${type}`)
      .join(", ");
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.config.table} (${columns})`);

    if (this.config.indexes) {
      for (const idx of this.config.indexes) {
        const idxName = `idx_${this.config.table}_${idx.join("_")}`;
        this.db.exec(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${this.config.table} (${idx.join(", ")})`);
      }
    }
  }

  create(data: Record<string, unknown>): void {
    const cols = Object.keys(data);
    const placeholders = cols.map(() => "?").join(", ");
    const values = cols.map((c) => this.serialize(data[c])) as Array<string | number | null>;
    this.db.prepare(`INSERT INTO ${this.config.table} (${cols.join(", ")}) VALUES (${placeholders})`).run(...values);
  }

  updateOne(key: string, updates: Record<string, unknown>): void {
    const setClauses = Object.keys(updates).map((c) => `${c} = ?`).join(", ");
    const values = Object.keys(updates).map((c) => this.serialize(updates[c])) as Array<string | number | null>;
    values.push(key);
    this.db.prepare(`UPDATE ${this.config.table} SET ${setClauses} WHERE ${this.config.key} = ?`).run(...values);
  }

  findOne(key: string): Record<string, unknown> | undefined {
    const row = this.db.prepare(`SELECT * FROM ${this.config.table} WHERE ${this.config.key} = ?`).get(key) as Record<string, unknown> | undefined;
    return row ? this.deserializeRow(row) : undefined;
  }

  findAll(): Record<string, unknown>[] {
    const rows = this.db.prepare(`SELECT * FROM ${this.config.table}`).all() as Record<string, unknown>[];
    return rows.map((r) => this.deserializeRow(r));
  }

  upsert(key: string, data: Record<string, unknown>): void {
    const existing = this.findOne(key);
    if (existing) {
      this.updateOne(key, data);
    } else {
      this.create({ ...data, [this.config.key]: key });
    }
  }

  private serialize(val: unknown): unknown {
    if (val === null || val === undefined) return null;
    if (typeof val === "object") return JSON.stringify(val);
    return val;
  }

  private deserializeRow(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
        try { result[k] = JSON.parse(v); } catch { result[k] = v; }
      } else {
        result[k] = v;
      }
    }
    return result;
  }
}

export class ReadModelBuilder {
  private db: DatabaseSync;
  private models: Array<{ repo: ReadRepository; handler: ReadModelHandler }> = [];
  private checkpoint: number = 0;

  constructor(dbPath: string = ":memory:") {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _checkpoints (
        model TEXT PRIMARY KEY,
        position INTEGER NOT NULL
      )
    `);
  }

  register(definition: ReadModelDefinition): ReadRepository {
    const repo = new ReadRepository(this.db, definition.config);
    this.models.push({ repo, handler: definition.handler });
    return repo;
  }

  /**
   * Subscribe to live events from the event store.
   */
  subscribeTo(eventStore: EventStore): () => void {
    return eventStore.subscribeToAll((event) => {
      this.project(event);
    });
  }

  /**
   * Catch up from the event store (replay past events).
   */
  catchUp(eventStore: EventStore): void {
    let batch: StoredEvent[];
    do {
      batch = eventStore.readAllBatch(this.checkpoint, 100);
      for (const event of batch) {
        this.project(event);
        this.checkpoint = event.globalPosition;
      }
    } while (batch.length === 100);
  }

  private project(event: StoredEvent): void {
    for (const model of this.models) {
      model.handler(model.repo, event);
    }
  }

  getDb(): DatabaseSync {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
