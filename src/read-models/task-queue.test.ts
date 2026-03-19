import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TaskQueueStore } from "./task-queue";
import {
  TaskSubmitted,
  TaskAssigned,
  TaskStarted,
  TaskCompleted,
  TaskFailed,
  TaskEscalated,
  TaskRetried,
} from "../domain/task/events";

function makeStore() {
  return new TaskQueueStore();
}

function submitEvent(taskId = "t1", category = "code", priority = "normal") {
  return new TaskSubmitted(
    taskId, "webhook", "src-1", { data: "test" },
    "2026-03-18T10:00:00Z", priority, undefined,
    "Test task", "A test description", category,
    "2026-03-18T10:00:00Z"
  );
}

describe("TaskQueueStore", () => {
  it("should create a record on TaskSubmitted", () => {
    const store = makeStore();
    store.apply(submitEvent());

    const record = store.get("t1");
    assert.ok(record);
    assert.equal(record.taskId, "t1");
    assert.equal(record.sourceType, "webhook");
    assert.equal(record.sourceId, "src-1");
    assert.equal(record.title, "Test task");
    assert.equal(record.description, "A test description");
    assert.equal(record.category, "code");
    assert.equal(record.priority, "normal");
    assert.equal(record.assignedAgent, null);
    assert.equal(record.status, "queued");
    assert.equal(record.startedAt, null);
    assert.equal(record.completedAt, null);
    assert.equal(record.result, null);
    assert.equal(record.error, null);
    assert.equal(record.retryCount, 0);
    assert.equal(record.durationMs, null);
  });

  it("should update on TaskAssigned", () => {
    const store = makeStore();
    store.apply(submitEvent());
    store.apply(new TaskAssigned("t1", "claude-code", "2026-03-18T10:01:00Z"));

    const record = store.get("t1")!;
    assert.equal(record.status, "assigned");
    assert.equal(record.assignedAgent, "claude-code");
  });

  it("should update on TaskStarted", () => {
    const store = makeStore();
    store.apply(submitEvent());
    store.apply(new TaskAssigned("t1", "agent", "2026-03-18T10:01:00Z"));
    store.apply(new TaskStarted("t1", "2026-03-18T10:02:00Z"));

    const record = store.get("t1")!;
    assert.equal(record.status, "running");
    assert.equal(record.startedAt, "2026-03-18T10:02:00Z");
  });

  it("should update on TaskCompleted with duration", () => {
    const store = makeStore();
    store.apply(submitEvent());
    store.apply(new TaskAssigned("t1", "agent", "2026-03-18T10:01:00Z"));
    store.apply(new TaskStarted("t1", "2026-03-18T10:02:00Z"));
    store.apply(new TaskCompleted("t1", { output: "done" }, "2026-03-18T10:05:00Z"));

    const record = store.get("t1")!;
    assert.equal(record.status, "completed");
    assert.deepEqual(record.result, { output: "done" });
    assert.equal(record.completedAt, "2026-03-18T10:05:00Z");
    assert.equal(record.durationMs, 3 * 60 * 1000);
  });

  it("should update on TaskFailed", () => {
    const store = makeStore();
    store.apply(submitEvent());
    store.apply(new TaskAssigned("t1", "agent", "2026-03-18T10:01:00Z"));
    store.apply(new TaskStarted("t1", "2026-03-18T10:02:00Z"));
    store.apply(new TaskFailed("t1", "Timeout", "2026-03-18T10:03:00Z"));

    const record = store.get("t1")!;
    assert.equal(record.status, "failed");
    assert.equal(record.error, "Timeout");
    assert.equal(record.completedAt, "2026-03-18T10:03:00Z");
    assert.equal(record.durationMs, 1 * 60 * 1000);
  });

  it("should update on TaskEscalated", () => {
    const store = makeStore();
    store.apply(submitEvent());
    store.apply(new TaskAssigned("t1", "agent", "2026-03-18T10:01:00Z"));
    store.apply(new TaskStarted("t1", "2026-03-18T10:02:00Z"));
    store.apply(new TaskEscalated("t1", "Max retries", "2026-03-18T10:04:00Z"));

    const record = store.get("t1")!;
    assert.equal(record.status, "escalated");
    assert.equal(record.error, "Max retries");
    assert.equal(record.completedAt, "2026-03-18T10:04:00Z");
    assert.equal(record.durationMs, 2 * 60 * 1000);
  });

  it("should reset on TaskRetried", () => {
    const store = makeStore();
    store.apply(submitEvent());
    store.apply(new TaskAssigned("t1", "agent", "2026-03-18T10:01:00Z"));
    store.apply(new TaskStarted("t1", "2026-03-18T10:02:00Z"));
    store.apply(new TaskFailed("t1", "err", "2026-03-18T10:03:00Z"));
    store.apply(new TaskRetried("t1", 1, "2026-03-18T10:04:00Z"));

    const record = store.get("t1")!;
    assert.equal(record.status, "queued");
    assert.equal(record.retryCount, 1);
    assert.equal(record.error, null);
    assert.equal(record.completedAt, null);
    assert.equal(record.assignedAgent, null);
    assert.equal(record.startedAt, null);
    assert.equal(record.result, null);
    assert.equal(record.durationMs, null);
  });

  it("should replay a full event sequence", () => {
    const store = makeStore();
    store.apply(submitEvent("t1", "code", "high"));
    store.apply(new TaskAssigned("t1", "claude-code", "2026-03-18T10:01:00Z"));
    store.apply(new TaskStarted("t1", "2026-03-18T10:02:00Z"));
    store.apply(new TaskFailed("t1", "first error", "2026-03-18T10:03:00Z"));
    store.apply(new TaskRetried("t1", 1, "2026-03-18T10:04:00Z"));
    store.apply(new TaskAssigned("t1", "claude-code", "2026-03-18T10:05:00Z"));
    store.apply(new TaskStarted("t1", "2026-03-18T10:06:00Z"));
    store.apply(new TaskCompleted("t1", { files: ["a.ts"] }, "2026-03-18T10:10:00Z"));

    const record = store.get("t1")!;
    assert.equal(record.status, "completed");
    assert.equal(record.retryCount, 1);
    assert.equal(record.assignedAgent, "claude-code");
    assert.deepEqual(record.result, { files: ["a.ts"] });
    assert.equal(record.durationMs, 4 * 60 * 1000);
  });

  it("should list with status filtering", () => {
    const store = makeStore();
    store.apply(submitEvent("t1"));
    store.apply(submitEvent("t2"));
    store.apply(new TaskAssigned("t2", "agent", "2026-03-18T10:01:00Z"));
    store.apply(new TaskStarted("t2", "2026-03-18T10:02:00Z"));
    store.apply(new TaskCompleted("t2", null, "2026-03-18T10:05:00Z"));

    assert.equal(store.list({ status: "queued" }).length, 1);
    assert.equal(store.list({ status: "completed" }).length, 1);
    assert.equal(store.list({ status: "failed" }).length, 0);
  });

  it("should list with category filtering", () => {
    const store = makeStore();
    store.apply(submitEvent("t1", "code"));
    store.apply(submitEvent("t2", "monitoring"));

    assert.equal(store.list({ category: "code" }).length, 1);
    assert.equal(store.list({ category: "monitoring" }).length, 1);
    assert.equal(store.list({ category: "research" }).length, 0);
  });

  it("should list with priority filtering", () => {
    const store = makeStore();
    store.apply(submitEvent("t1", "code", "high"));
    store.apply(submitEvent("t2", "code", "low"));

    assert.equal(store.list({ priority: "high" }).length, 1);
    assert.equal(store.list({ priority: "low" }).length, 1);
  });

  it("should list with sourceType filtering", () => {
    const store = makeStore();
    store.apply(submitEvent("t1"));
    store.apply(new TaskSubmitted(
      "t2", "github", "gh-1", {}, "2026-03-18T10:00:00Z", "normal",
      undefined, "GH task", "desc", "code", "2026-03-18T10:00:00Z"
    ));

    assert.equal(store.list({ sourceType: "webhook" }).length, 1);
    assert.equal(store.list({ sourceType: "github" }).length, 1);
  });

  it("should list with assignedAgent filtering", () => {
    const store = makeStore();
    store.apply(submitEvent("t1"));
    store.apply(submitEvent("t2"));
    store.apply(new TaskAssigned("t1", "claude-code", "2026-03-18T10:01:00Z"));

    assert.equal(store.list({ assignedAgent: "claude-code" }).length, 1);
    assert.equal(store.list({ assignedAgent: "browser" }).length, 0);
  });

  it("should support pagination", () => {
    const store = makeStore();
    store.apply(submitEvent("t1"));
    store.apply(submitEvent("t2"));
    store.apply(submitEvent("t3"));

    const page = store.list({ limit: 2, offset: 1 });
    assert.equal(page.length, 2);
    assert.equal(page[0].taskId, "t2");
    assert.equal(page[1].taskId, "t3");
  });

  it("should return undefined for unknown taskId", () => {
    const store = makeStore();
    assert.equal(store.get("nonexistent"), undefined);
  });

  it("should return all tasks via getAll", () => {
    const store = makeStore();
    store.apply(submitEvent("t1"));
    store.apply(submitEvent("t2"));
    assert.equal(store.getAll().length, 2);
  });

  it("should ignore events for unknown taskId", () => {
    const store = makeStore();
    store.apply(new TaskAssigned("unknown", "agent", "2026-03-18T10:00:00Z"));
    assert.equal(store.getAll().length, 0);
  });
});
