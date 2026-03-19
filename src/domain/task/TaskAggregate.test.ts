import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TaskAggregate } from "./TaskAggregate";
import { SubmitTask, AssignTask, StartTask, CompleteTask, FailTask, EscalateTask, RetryTask } from "./commands";
import { TaskSubmitted, TaskAssigned, TaskStarted, TaskCompleted, TaskFailed, TaskEscalated, TaskRetried } from "./events";

function makeAggregate() {
  return new TaskAggregate();
}

function submitTask(agg: TaskAggregate, taskId = "t1") {
  const events = agg.execute(new SubmitTask(
    taskId, "webhook", "src-1", { data: "test" },
    "2026-03-18T10:00:00Z", "normal", undefined,
    "Test task", "A test task description", "code", "2026-03-18T10:00:00Z"
  ));
  for (const e of events as any[]) agg.hydrate(e);
  return events;
}

describe("TaskAggregate", () => {
  it("should submit a task", () => {
    const agg = makeAggregate();
    const events = submitTask(agg);
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof TaskSubmitted);
    assert.equal((events[0] as TaskSubmitted).taskId, "t1");
    assert.equal((events[0] as TaskSubmitted).title, "Test task");
    assert.equal((events[0] as TaskSubmitted).category, "code");
  });

  it("should assign a queued task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    const events = agg.execute(new AssignTask("t1", "claude-code", "2026-03-18T10:01:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof TaskAssigned);
    assert.equal((events[0] as TaskAssigned).agentName, "claude-code");
  });

  it("should reject assign on non-queued task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    const assignEvents = agg.execute(new AssignTask("t1", "agent", "2026-03-18T10:01:00Z")) as any[];
    for (const e of assignEvents) agg.hydrate(e);
    assert.throws(() => {
      agg.execute(new AssignTask("t1", "agent2", "2026-03-18T10:02:00Z"));
    }, /not in queued state/);
  });

  it("should start an assigned task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    const assignEvents = agg.execute(new AssignTask("t1", "agent", "2026-03-18T10:01:00Z")) as any[];
    for (const e of assignEvents) agg.hydrate(e);
    const startEvents = agg.execute(new StartTask("t1", "2026-03-18T10:02:00Z"));
    assert.equal(startEvents.length, 1);
    assert.ok(startEvents[0] instanceof TaskStarted);
  });

  it("should reject start on non-assigned task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    assert.throws(() => {
      agg.execute(new StartTask("t1", "2026-03-18T10:02:00Z"));
    }, /not in assigned state/);
  });

  it("should complete a running task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    for (const e of agg.execute(new AssignTask("t1", "agent", "2026-03-18T10:01:00Z")) as any[]) agg.hydrate(e);
    for (const e of agg.execute(new StartTask("t1", "2026-03-18T10:02:00Z")) as any[]) agg.hydrate(e);
    const events = agg.execute(new CompleteTask("t1", { output: "done" }, "2026-03-18T10:05:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof TaskCompleted);
    assert.deepEqual((events[0] as TaskCompleted).result, { output: "done" });
  });

  it("should fail a running task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    for (const e of agg.execute(new AssignTask("t1", "agent", "2026-03-18T10:01:00Z")) as any[]) agg.hydrate(e);
    for (const e of agg.execute(new StartTask("t1", "2026-03-18T10:02:00Z")) as any[]) agg.hydrate(e);
    const events = agg.execute(new FailTask("t1", "Timeout", "2026-03-18T10:05:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof TaskFailed);
    assert.equal((events[0] as TaskFailed).error, "Timeout");
  });

  it("should escalate a failed task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    for (const e of agg.execute(new AssignTask("t1", "agent", "2026-03-18T10:01:00Z")) as any[]) agg.hydrate(e);
    for (const e of agg.execute(new StartTask("t1", "2026-03-18T10:02:00Z")) as any[]) agg.hydrate(e);
    for (const e of agg.execute(new FailTask("t1", "err", "2026-03-18T10:05:00Z")) as any[]) agg.hydrate(e);
    const events = agg.execute(new EscalateTask("t1", "Max retries", "2026-03-18T10:06:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof TaskEscalated);
  });

  it("should retry a failed task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    for (const e of agg.execute(new AssignTask("t1", "agent", "2026-03-18T10:01:00Z")) as any[]) agg.hydrate(e);
    for (const e of agg.execute(new StartTask("t1", "2026-03-18T10:02:00Z")) as any[]) agg.hydrate(e);
    for (const e of agg.execute(new FailTask("t1", "err", "2026-03-18T10:05:00Z")) as any[]) agg.hydrate(e);
    const events = agg.execute(new RetryTask("t1", 1, "2026-03-18T10:06:00Z"));
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof TaskRetried);
    assert.equal((events[0] as TaskRetried).retryCount, 1);
  });

  it("should reject retry on non-failed task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    assert.throws(() => {
      agg.execute(new RetryTask("t1", 1, "2026-03-18T10:06:00Z"));
    }, /not in failed state/);
  });

  it("should reject escalate on completed task", () => {
    const agg = makeAggregate();
    submitTask(agg);
    for (const e of agg.execute(new AssignTask("t1", "agent", "2026-03-18T10:01:00Z")) as any[]) agg.hydrate(e);
    for (const e of agg.execute(new StartTask("t1", "2026-03-18T10:02:00Z")) as any[]) agg.hydrate(e);
    for (const e of agg.execute(new CompleteTask("t1", {}, "2026-03-18T10:05:00Z")) as any[]) agg.hydrate(e);
    assert.throws(() => {
      agg.execute(new EscalateTask("t1", "reason", "2026-03-18T10:06:00Z"));
    }, /already finished/);
  });
});
