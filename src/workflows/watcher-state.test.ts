import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FileWatcherStatePersistence } from "./watcher-state";
import type { WatcherState } from "./github-watcher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `watcher-state-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeState(overrides?: Partial<WatcherState>): WatcherState {
  return {
    activeIssues: new Set(overrides?.activeIssues ?? []),
    completedIssues: new Set(overrides?.completedIssues ?? []),
    failedIssues: new Set(overrides?.failedIssues ?? []),
    retryCounts: new Map(overrides?.retryCounts ?? []),
    results: overrides?.results ?? [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileWatcherStatePersistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save/load round-trip preserves completedIssues", async () => {
    const filePath = join(tmpDir, "watcher-state.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    const state = makeState({
      completedIssues: new Set(["42", "99", "101"]),
    });

    await persistence.save(state);
    const loaded = await persistence.load();

    assert.ok(loaded);
    assert.deepEqual(loaded.completedIssues, new Set(["42", "99", "101"]));
  });

  it("save/load round-trip preserves failedIssues", async () => {
    const filePath = join(tmpDir, "watcher-state.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    const state = makeState({
      failedIssues: new Set(["7", "13"]),
    });

    await persistence.save(state);
    const loaded = await persistence.load();

    assert.ok(loaded);
    assert.deepEqual(loaded.failedIssues, new Set(["7", "13"]));
  });

  it("save/load round-trip preserves retryCounts", async () => {
    const filePath = join(tmpDir, "watcher-state.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    const state = makeState({
      retryCounts: new Map([["42", 2], ["99", 1]]),
    });

    await persistence.save(state);
    const loaded = await persistence.load();

    assert.ok(loaded);
    assert.equal(loaded.retryCounts.get("42"), 2);
    assert.equal(loaded.retryCounts.get("99"), 1);
  });

  it("activeIssues are NOT restored (they represent interrupted work)", async () => {
    const filePath = join(tmpDir, "watcher-state.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    const state = makeState({
      activeIssues: new Set(["42", "99"]),
      completedIssues: new Set(["1"]),
    });

    await persistence.save(state);
    const loaded = await persistence.load();

    assert.ok(loaded);
    assert.equal(loaded.activeIssues.size, 0);
  });

  it("results are empty on load (not persisted)", async () => {
    const filePath = join(tmpDir, "watcher-state.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    const state = makeState({
      completedIssues: new Set(["42"]),
      results: [
        {
          issueNumber: 42,
          branch: "tierzero/42-test",
          status: "success" as const,
          summary: "done",
          testsRun: 10,
          testsPassed: 10,
          filesChanged: ["a.ts"],
        },
      ],
    });

    await persistence.save(state);
    const loaded = await persistence.load();

    assert.ok(loaded);
    assert.deepEqual(loaded.results, []);
  });

  it("load returns null when no file exists", async () => {
    const filePath = join(tmpDir, "nonexistent.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    const loaded = await persistence.load();
    assert.equal(loaded, null);
  });

  it("load returns null on corrupt JSON", async () => {
    const filePath = join(tmpDir, "watcher-state.json");
    mkdirSync(tmpDir, { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, "NOT VALID JSON{{{", "utf-8");

    const persistence = new FileWatcherStatePersistence({ filePath });
    const loaded = await persistence.load();
    assert.equal(loaded, null);
  });

  it("atomic write creates the file (temp file should not remain)", async () => {
    const filePath = join(tmpDir, "watcher-state.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    await persistence.save(makeState({ completedIssues: new Set(["1"]) }));

    assert.ok(existsSync(filePath));

    // No .tmp files should remain
    const { readdirSync } = await import("node:fs");
    const tmpFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0);
  });

  it("overwrite preserves latest state", async () => {
    const filePath = join(tmpDir, "watcher-state.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    await persistence.save(makeState({ completedIssues: new Set(["1"]) }));
    await persistence.save(makeState({ completedIssues: new Set(["1", "2", "3"]) }));

    const loaded = await persistence.load();
    assert.ok(loaded);
    assert.deepEqual(loaded.completedIssues, new Set(["1", "2", "3"]));
  });

  it("creates parent directories if they don't exist", async () => {
    const filePath = join(tmpDir, "nested", "deep", "watcher-state.json");
    const persistence = new FileWatcherStatePersistence({ filePath });

    await persistence.save(makeState({ completedIssues: new Set(["1"]) }));
    assert.ok(existsSync(filePath));
  });

  it("E2E: completed issues are never re-processed after simulated restart", async () => {
    const filePath = join(tmpDir, "watcher-state.json");

    // Simulate first run: process issues 42 and 99
    const persistence1 = new FileWatcherStatePersistence({ filePath });
    const state1 = makeState({
      completedIssues: new Set(["42", "99"]),
      failedIssues: new Set(["7"]),
      retryCounts: new Map([["7", 3]]),
    });
    await persistence1.save(state1);

    // Simulate restart: load state from disk
    const persistence2 = new FileWatcherStatePersistence({ filePath });
    const state2 = await persistence2.load();

    assert.ok(state2);
    // Issues 42 and 99 should be in completedIssues, so watcher will skip them
    assert.ok(state2.completedIssues.has("42"));
    assert.ok(state2.completedIssues.has("99"));
    // Issue 7 should be in failedIssues with retained retry count
    assert.ok(state2.failedIssues.has("7"));
    assert.equal(state2.retryCounts.get("7"), 3);
  });
});
