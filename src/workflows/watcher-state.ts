/**
 * Watcher State Persistence.
 *
 * Saves and loads watcher state to/from disk so that completed issues,
 * failed issues, and retry counts survive process restarts.
 * Uses atomic writes (write to temp file, then rename) to prevent corruption.
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { WatcherState } from "./github-watcher";
import { createLogger } from "../infra/logger";

const log = createLogger("watcher-state");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** JSON-serializable representation of WatcherState */
export interface SerializedWatcherState {
  activeIssues: string[];
  completedIssues: string[];
  failedIssues: string[];
  retryCounts: Record<string, number>;
  /** Results are intentionally omitted — they can be large and are not needed for dedup */
  savedAt: string;
}

export interface WatcherStatePersistence {
  save(state: WatcherState): Promise<void>;
  load(): Promise<WatcherState | null>;
}

export interface WatcherStatePersistenceOptions {
  /** Path to the state file (default: .tierzero/watcher-state.json) */
  filePath?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class FileWatcherStatePersistence implements WatcherStatePersistence {
  private readonly filePath: string;

  constructor(options?: WatcherStatePersistenceOptions) {
    this.filePath =
      options?.filePath ??
      join(process.cwd(), ".tierzero", "watcher-state.json");
  }

  getFilePath(): string {
    return this.filePath;
  }

  async save(state: WatcherState): Promise<void> {
    const serialized: SerializedWatcherState = {
      activeIssues: [...state.activeIssues],
      completedIssues: [...state.completedIssues],
      failedIssues: [...state.failedIssues],
      retryCounts: Object.fromEntries(state.retryCounts),
      savedAt: new Date().toISOString(),
    };

    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    // Atomic write: write to temp file, then rename
    const tmpPath = join(dir, `.watcher-state-${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(serialized, null, 2), "utf-8");
    renameSync(tmpPath, this.filePath);

    log.info("Watcher state saved", {
      completed: serialized.completedIssues.length,
      failed: serialized.failedIssues.length,
      retries: Object.keys(serialized.retryCounts).length,
    });
  }

  async load(): Promise<WatcherState | null> {
    if (!existsSync(this.filePath)) {
      log.info("No saved watcher state found");
      return null;
    }

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as SerializedWatcherState;

      const state: WatcherState = {
        activeIssues: new Set<string>(),
        completedIssues: new Set(data.completedIssues),
        failedIssues: new Set(data.failedIssues),
        retryCounts: new Map(Object.entries(data.retryCounts)),
        results: [],
      };

      // activeIssues are intentionally NOT restored — they represent
      // in-flight work that was interrupted and should be re-evaluated
      log.info("Watcher state loaded", {
        completed: data.completedIssues.length,
        failed: data.failedIssues.length,
        retries: Object.keys(data.retryCounts).length,
      });

      return state;
    } catch (err) {
      log.error("Failed to load watcher state", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
