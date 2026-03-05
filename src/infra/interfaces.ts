/**
 * Shared CQRS/ES interfaces.
 */

export interface StoredEvent {
  globalPosition: number;
  streamId: string;
  version: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface EventFactory {
  (type: string, data: Record<string, unknown>): unknown;
}

export interface ReadModelConfig {
  table: string;
  key: string;
  schema: Record<string, string>; // column -> SQLite type
  indexes?: string[][];
}

export interface ReadModelHandler {
  (repo: ReadModelRepo, event: StoredEvent): void;
}

export interface ReadModelRepo {
  create(data: Record<string, unknown>): void;
  updateOne(key: string, updates: Record<string, unknown>): void;
  findOne(key: string): Record<string, unknown> | undefined;
  findAll(): Record<string, unknown>[];
  upsert(key: string, data: Record<string, unknown>): void;
}

export interface ReadModelDefinition {
  config: ReadModelConfig;
  handler: ReadModelHandler;
}
