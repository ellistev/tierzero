import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskToIssueContext } from "./task-adapter";
import type { NormalizedTask } from "./agent-registry";

function makeTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    taskId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    source: {
      type: "webhook",
      id: "src-1",
      payload: {},
      receivedAt: new Date().toISOString(),
    },
    title: "Fix login bug",
    description: "Users cannot log in when password contains special chars",
    category: "code",
    priority: "high",
    assignedAgent: null,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

describe("taskToIssueContext", () => {
  it("converts NormalizedTask to IssueContext with correct fields", () => {
    const task = makeTask();
    const ctx = taskToIssueContext(task);

    assert.equal(ctx.title, "Fix login bug");
    assert.equal(ctx.description, "Users cannot log in when password contains special chars");
    assert.deepEqual(ctx.comments, []);
    assert.deepEqual(ctx.labels, ["code", "high"]);
  });

  it("derives a stable number from taskId", () => {
    const task = makeTask({ taskId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
    const ctx1 = taskToIssueContext(task);
    const ctx2 = taskToIssueContext(task);

    assert.equal(ctx1.number, ctx2.number);
    assert.equal(typeof ctx1.number, "number");
    assert.ok(ctx1.number >= 0 && ctx1.number < 100000);
  });

  it("produces different numbers for different taskIds", () => {
    const task1 = makeTask({ taskId: "11111111-1111-1111-1111-111111111111" });
    const task2 = makeTask({ taskId: "ffffffff-ffff-ffff-ffff-ffffffffffff" });

    const ctx1 = taskToIssueContext(task1);
    const ctx2 = taskToIssueContext(task2);

    assert.notEqual(ctx1.number, ctx2.number);
  });

  it("includes category and priority as labels", () => {
    const task = makeTask({ category: "operations", priority: "critical" });
    const ctx = taskToIssueContext(task);

    assert.deepEqual(ctx.labels, ["operations", "critical"]);
  });
});
