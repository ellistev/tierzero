import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  FileCheckpointManager,
  cleanupOrphans,
  installGracefulShutdown,
  type PipelineCheckpoint,
  type PipelineStage,
  type OrphanCleanupDeps,
} from "./pipeline-checkpoint";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = join(tmpdir(), `checkpoint-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeCheckpoint(overrides?: Partial<PipelineCheckpoint>): PipelineCheckpoint {
  return {
    issueNumber: overrides?.issueNumber ?? 42,
    branch: overrides?.branch ?? "tierzero/42-test-feature",
    stage: overrides?.stage ?? "branch-created",
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
    data: overrides?.data ?? {},
  };
}

// ---------------------------------------------------------------------------
// FileCheckpointManager Tests
// ---------------------------------------------------------------------------

describe("FileCheckpointManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save and load round-trip", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    const cp = makeCheckpoint({
      stage: "pr-created",
      data: { prNumber: 123, prUrl: "https://github.com/test/pr/123" },
    });

    await mgr.save(cp);
    const loaded = await mgr.load(42);

    assert.ok(loaded);
    assert.equal(loaded.issueNumber, 42);
    assert.equal(loaded.stage, "pr-created");
    assert.equal(loaded.branch, "tierzero/42-test-feature");
    assert.equal(loaded.data.prNumber, 123);
  });

  it("load returns null for non-existent checkpoint", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    const loaded = await mgr.load(999);
    assert.equal(loaded, null);
  });

  it("remove deletes checkpoint file", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    await mgr.save(makeCheckpoint());
    assert.ok(existsSync(join(tmpDir, "issue-42.json")));

    await mgr.remove(42);
    assert.ok(!existsSync(join(tmpDir, "issue-42.json")));
  });

  it("remove is idempotent for non-existent checkpoint", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    await mgr.remove(999); // Should not throw
  });

  it("save overwrites previous checkpoint (stage progression)", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });

    await mgr.save(makeCheckpoint({ stage: "branch-created" }));
    await mgr.save(makeCheckpoint({ stage: "agent-complete" }));
    await mgr.save(makeCheckpoint({ stage: "tests-passed" }));

    const loaded = await mgr.load(42);
    assert.ok(loaded);
    assert.equal(loaded.stage, "tests-passed");
  });

  it("listIncomplete returns non-terminal checkpoints", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });

    await mgr.save(makeCheckpoint({ issueNumber: 1, stage: "branch-created" }));
    await mgr.save(makeCheckpoint({ issueNumber: 2, stage: "agent-complete" }));
    await mgr.save(makeCheckpoint({ issueNumber: 3, stage: "pr-created" }));
    await mgr.save(makeCheckpoint({ issueNumber: 4, stage: "merged" }));
    await mgr.save(makeCheckpoint({ issueNumber: 5, stage: "deployed" }));

    const incomplete = await mgr.listIncomplete();
    const issueNumbers = incomplete.map((c) => c.issueNumber).sort();

    assert.deepEqual(issueNumbers, [1, 2, 3]);
  });

  it("listIncomplete returns empty for empty directory", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    const incomplete = await mgr.listIncomplete();
    assert.deepEqual(incomplete, []);
  });

  it("atomic write leaves no temp files", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    await mgr.save(makeCheckpoint());

    const tmpFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0);
  });

  it("resume from each stage", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    const stages: PipelineStage[] = [
      "branch-created",
      "agent-complete",
      "tests-passed",
      "pr-created",
      "merged",
      "deployed",
    ];

    for (const stage of stages) {
      const cp = makeCheckpoint({ issueNumber: 100, stage });
      await mgr.save(cp);
      const loaded = await mgr.load(100);
      assert.ok(loaded);
      assert.equal(loaded.stage, stage);
    }
  });
});

// ---------------------------------------------------------------------------
// Orphan Cleanup Tests
// ---------------------------------------------------------------------------

describe("cleanupOrphans", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects stale branches without PRs", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    const deps: OrphanCleanupDeps = {
      listBranches: () => [
        "main",
        "tierzero/42-some-feature",
        "tierzero/99-another",
        "feature/custom-branch",
        "unrelated-branch",
      ],
      listOpenPRBranches: () => [
        { branch: "tierzero/99-another", prNumber: 5 },
      ],
      deleteBranch: () => {},
    };

    const result = await cleanupOrphans(deps, mgr, new Set());

    assert.deepEqual(result.staleBranches.sort(), [
      "feature/custom-branch",
      "tierzero/42-some-feature",
    ]);
  });

  it("detects orphaned PRs from previous runs", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    const deps: OrphanCleanupDeps = {
      listBranches: () => ["main", "tierzero/42-feat"],
      listOpenPRBranches: () => [
        { branch: "tierzero/42-feat", prNumber: 10 },
        { branch: "unrelated-branch", prNumber: 11 },
      ],
      deleteBranch: () => {},
    };

    const result = await cleanupOrphans(deps, mgr, new Set());
    assert.equal(result.orphanedPRs.length, 1);
    assert.equal(result.orphanedPRs[0].branch, "tierzero/42-feat");
    assert.equal(result.orphanedPRs[0].prNumber, 10);
  });

  it("cleans checkpoints for completed issues", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    await mgr.save(makeCheckpoint({ issueNumber: 42, stage: "pr-created" }));
    await mgr.save(makeCheckpoint({ issueNumber: 99, stage: "agent-complete" }));

    const deps: OrphanCleanupDeps = {
      listBranches: () => [],
      listOpenPRBranches: () => [],
      deleteBranch: () => {},
    };

    const completedIssues = new Set(["42"]);
    const result = await cleanupOrphans(deps, mgr, completedIssues);

    assert.deepEqual(result.cleanedCheckpoints, [42]);
    // Issue 42 checkpoint should be removed
    assert.equal(await mgr.load(42), null);
    // Issue 99 checkpoint should remain
    assert.ok(await mgr.load(99));
  });

  it("handles empty state gracefully", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });
    const deps: OrphanCleanupDeps = {
      listBranches: () => [],
      listOpenPRBranches: () => [],
      deleteBranch: () => {},
    };

    const result = await cleanupOrphans(deps, mgr, new Set());
    assert.deepEqual(result.staleBranches, []);
    assert.deepEqual(result.orphanedPRs, []);
    assert.deepEqual(result.cleanedCheckpoints, []);
  });
});

// ---------------------------------------------------------------------------
// Graceful Shutdown Tests
// ---------------------------------------------------------------------------

describe("installGracefulShutdown", () => {
  it("returns a cleanup function that removes handlers", () => {
    let saveCalled = false;
    const cleanup = installGracefulShutdown({
      onSaveState: async () => { saveCalled = true; },
      isAgentRunning: () => false,
      logger: { log: () => {}, error: () => {} },
    });

    assert.equal(typeof cleanup, "function");
    cleanup(); // Should not throw
    // saveCalled should remain false since we didn't send a signal
    assert.equal(saveCalled, false);
  });
});

// ---------------------------------------------------------------------------
// Restart Simulation Tests
// ---------------------------------------------------------------------------

describe("Restart simulation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stop mid-pipeline and resume from last checkpoint", async () => {
    const mgr = new FileCheckpointManager({ directory: tmpDir });

    // Simulate pipeline reaching "agent-complete" stage then crashing
    await mgr.save(makeCheckpoint({
      issueNumber: 42,
      stage: "agent-complete",
      data: { summary: "Implemented feature X", filesChanged: ["src/x.ts"] },
    }));

    // Simulate restart: list incomplete checkpoints
    const incomplete = await mgr.listIncomplete();
    assert.equal(incomplete.length, 1);
    assert.equal(incomplete[0].issueNumber, 42);
    assert.equal(incomplete[0].stage, "agent-complete");

    // Pipeline would resume from "agent-complete" → next step is "tests"
    // Simulate completing the pipeline
    await mgr.save(makeCheckpoint({
      issueNumber: 42,
      stage: "merged",
      data: { prNumber: 100 },
    }));

    // Now it should not appear in incomplete
    const incomplete2 = await mgr.listIncomplete();
    assert.equal(incomplete2.length, 0);
  });

  it("E2E: process issue, save checkpoint, simulate crash, verify resume", async () => {
    const checkpointDir = join(tmpDir, "checkpoints");
    const stateFile = join(tmpDir, "watcher-state.json");
    const { FileWatcherStatePersistence } = await import("./watcher-state");

    const mgr = new FileCheckpointManager({ directory: checkpointDir });
    const statePersistence = new FileWatcherStatePersistence({ filePath: stateFile });

    // === First run: process issue 42, checkpoint at pr-created, then "crash" ===
    await mgr.save(makeCheckpoint({
      issueNumber: 42,
      stage: "pr-created",
      data: { prNumber: 10, prUrl: "https://github.com/test/pr/10" },
    }));

    // Watcher state at crash time
    const state1 = {
      activeIssues: new Set(["42"]),
      completedIssues: new Set(["10", "20"]),
      failedIssues: new Set(["5"]),
      retryCounts: new Map([["5", 3]]),
      results: [],
    };
    await statePersistence.save(state1);

    // === Simulate restart ===
    const loadedState = await statePersistence.load();
    assert.ok(loadedState);

    // activeIssues should be empty (not restored)
    assert.equal(loadedState.activeIssues.size, 0);
    // Previously completed issues are preserved
    assert.ok(loadedState.completedIssues.has("10"));
    assert.ok(loadedState.completedIssues.has("20"));
    // Failed issues and retry counts preserved
    assert.ok(loadedState.failedIssues.has("5"));
    assert.equal(loadedState.retryCounts.get("5"), 3);

    // Check for incomplete checkpoints to resume
    const incomplete = await mgr.listIncomplete();
    assert.equal(incomplete.length, 1);
    assert.equal(incomplete[0].issueNumber, 42);
    assert.equal(incomplete[0].stage, "pr-created");

    // Issue 42 was active (in-flight) — it's NOT in completedIssues,
    // so it won't be skipped by the watcher. The checkpoint tells us
    // to resume from "pr-created" stage instead of starting over.
    assert.ok(!loadedState.completedIssues.has("42"));
  });
});
