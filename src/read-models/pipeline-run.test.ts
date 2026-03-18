import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PipelineRunStore } from "./pipeline-run";
import {
  PipelineStarted,
  AgentWorkCompleted,
  TestsRan,
  TestFixApplied,
  PRCreated,
  PipelineCompleted,
  PipelineFailed,
} from "../domain/issue-pipeline/events";

function makeStore() {
  return new PipelineRunStore();
}

describe("PipelineRunStore", () => {
  it("should create a record on PipelineStarted", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 42, "Fix login bug", "fix/login-42", "2026-03-01T10:00:00Z"));

    const record = store.get("p1");
    assert.ok(record);
    assert.equal(record.pipelineId, "p1");
    assert.equal(record.issueNumber, 42);
    assert.equal(record.title, "Fix login bug");
    assert.equal(record.branch, "fix/login-42");
    assert.equal(record.status, "started");
    assert.equal(record.summary, "");
    assert.deepEqual(record.filesChanged, []);
    assert.equal(record.testsRun, 0);
    assert.equal(record.testsPassed, 0);
    assert.equal(record.testAttempts, 0);
    assert.equal(record.prNumber, null);
    assert.equal(record.prUrl, null);
    assert.equal(record.error, null);
    assert.equal(record.startedAt, "2026-03-01T10:00:00Z");
    assert.equal(record.completedAt, null);
    assert.equal(record.durationMs, null);
  });

  it("should update on AgentWorkCompleted", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "Title", "branch", "2026-03-01T10:00:00Z"));
    store.apply(new AgentWorkCompleted("p1", "Implemented feature X", ["src/a.ts", "src/b.ts"], "2026-03-01T10:05:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "agent_done");
    assert.equal(record.summary, "Implemented feature X");
    assert.deepEqual(record.filesChanged, ["src/a.ts", "src/b.ts"]);
  });

  it("should update on TestsRan (passing)", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "Title", "branch", "2026-03-01T10:00:00Z"));
    store.apply(new TestsRan("p1", true, 10, 10, 0, 1, "2026-03-01T10:06:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "tests_passing");
    assert.equal(record.testsRun, 10);
    assert.equal(record.testsPassed, 10);
    assert.equal(record.testAttempts, 1);
  });

  it("should update on TestsRan (failing)", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "Title", "branch", "2026-03-01T10:00:00Z"));
    store.apply(new TestsRan("p1", false, 10, 8, 2, 1, "2026-03-01T10:06:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "tests_failing");
    assert.equal(record.testsRun, 10);
    assert.equal(record.testsPassed, 8);
    assert.equal(record.testAttempts, 1);
  });

  it("should append summary and merge filesChanged on TestFixApplied", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "Title", "branch", "2026-03-01T10:00:00Z"));
    store.apply(new AgentWorkCompleted("p1", "Initial work", ["src/a.ts"], "2026-03-01T10:05:00Z"));
    store.apply(new TestFixApplied("p1", 1, "Fixed test util", ["src/a.ts", "src/c.ts"], "2026-03-01T10:07:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.summary, "Initial work\nFixed test util");
    assert.deepEqual(record.filesChanged.sort(), ["src/a.ts", "src/c.ts"]);
  });

  it("should update on PRCreated", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "Title", "branch", "2026-03-01T10:00:00Z"));
    store.apply(new PRCreated("p1", 99, "https://github.com/org/repo/pull/99", false, "2026-03-01T10:08:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "pr_created");
    assert.equal(record.prNumber, 99);
    assert.equal(record.prUrl, "https://github.com/org/repo/pull/99");
  });

  it("should update on PipelineCompleted with duration", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "Title", "branch", "2026-03-01T10:00:00Z"));
    store.apply(new PipelineCompleted("p1", "success", "2026-03-01T10:10:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "completed");
    assert.equal(record.completedAt, "2026-03-01T10:10:00Z");
    assert.equal(record.durationMs, 10 * 60 * 1000);
  });

  it("should update on PipelineFailed with error and duration", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "Title", "branch", "2026-03-01T10:00:00Z"));
    store.apply(new PipelineFailed("p1", "Agent crashed", "2026-03-01T10:03:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "failed");
    assert.equal(record.error, "Agent crashed");
    assert.equal(record.completedAt, "2026-03-01T10:03:00Z");
    assert.equal(record.durationMs, 3 * 60 * 1000);
  });

  it("should replay a full event sequence", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 7, "Add search", "feat/search-7", "2026-03-01T10:00:00Z"));
    store.apply(new AgentWorkCompleted("p1", "Added search endpoint", ["src/search.ts"], "2026-03-01T10:05:00Z"));
    store.apply(new TestsRan("p1", false, 12, 10, 2, 1, "2026-03-01T10:06:00Z"));
    store.apply(new TestFixApplied("p1", 1, "Fixed import", ["src/search.ts", "src/index.ts"], "2026-03-01T10:07:00Z"));
    store.apply(new TestsRan("p1", true, 12, 12, 0, 2, "2026-03-01T10:08:00Z"));
    store.apply(new PRCreated("p1", 55, "https://github.com/org/repo/pull/55", false, "2026-03-01T10:09:00Z"));
    store.apply(new PipelineCompleted("p1", "success", "2026-03-01T10:10:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "completed");
    assert.equal(record.issueNumber, 7);
    assert.equal(record.title, "Add search");
    assert.equal(record.branch, "feat/search-7");
    assert.equal(record.summary, "Added search endpoint\nFixed import");
    assert.deepEqual(record.filesChanged.sort(), ["src/index.ts", "src/search.ts"]);
    assert.equal(record.testsRun, 12);
    assert.equal(record.testsPassed, 12);
    assert.equal(record.testAttempts, 2);
    assert.equal(record.prNumber, 55);
    assert.equal(record.prUrl, "https://github.com/org/repo/pull/55");
    assert.equal(record.error, null);
    assert.equal(record.completedAt, "2026-03-01T10:10:00Z");
    assert.equal(record.durationMs, 10 * 60 * 1000);
  });

  it("should list with status filtering", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "A", "b1", "2026-03-01T10:00:00Z"));
    store.apply(new PipelineCompleted("p1", "success", "2026-03-01T10:10:00Z"));
    store.apply(new PipelineStarted("p2", 2, "B", "b2", "2026-03-01T11:00:00Z"));
    store.apply(new PipelineFailed("p2", "err", "2026-03-01T11:05:00Z"));
    store.apply(new PipelineStarted("p3", 3, "C", "b3", "2026-03-01T12:00:00Z"));
    store.apply(new PipelineCompleted("p3", "success", "2026-03-01T12:10:00Z"));

    assert.equal(store.list().length, 3);
    assert.equal(store.list({ status: "completed" }).length, 2);
    assert.equal(store.list({ status: "failed" }).length, 1);
    assert.equal(store.list({ status: "started" }).length, 0);
  });

  it("should support pagination in list", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "A", "b1", "2026-03-01T10:00:00Z"));
    store.apply(new PipelineStarted("p2", 2, "B", "b2", "2026-03-01T11:00:00Z"));
    store.apply(new PipelineStarted("p3", 3, "C", "b3", "2026-03-01T12:00:00Z"));

    const page = store.list({ limit: 2, offset: 1 });
    assert.equal(page.length, 2);
    assert.equal(page[0].pipelineId, "p2");
    assert.equal(page[1].pipelineId, "p3");
  });

  it("should return undefined for unknown pipelineId", () => {
    const store = makeStore();
    assert.equal(store.get("nonexistent"), undefined);
  });

  it("should return all runs via getAll", () => {
    const store = makeStore();
    store.apply(new PipelineStarted("p1", 1, "A", "b1", "2026-03-01T10:00:00Z"));
    store.apply(new PipelineStarted("p2", 2, "B", "b2", "2026-03-01T11:00:00Z"));

    assert.equal(store.getAll().length, 2);
  });

  it("should ignore events for unknown pipelineId", () => {
    const store = makeStore();
    store.apply(new AgentWorkCompleted("unknown", "summary", ["f.ts"], "2026-03-01T10:00:00Z"));
    assert.equal(store.getAll().length, 0);
  });
});
