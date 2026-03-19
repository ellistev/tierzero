import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentProcessStore } from "./agent-processes";
import {
  AgentSpawned,
  AgentHeartbeatReceived,
  AgentCompleted,
  AgentFailed,
  AgentHung,
  AgentKilled,
} from "../domain/agent-process/events";

function makeStore() {
  return new AgentProcessStore();
}

describe("AgentProcessStore", () => {
  it("should create a record on AgentSpawned", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "claude-code", "task-1", "2026-03-01T10:00:00Z"));

    const record = store.get("p1");
    assert.ok(record);
    assert.equal(record.processId, "p1");
    assert.equal(record.agentName, "claude-code");
    assert.equal(record.taskId, "task-1");
    assert.equal(record.status, "starting");
    assert.equal(record.startedAt, "2026-03-01T10:00:00Z");
    assert.equal(record.lastHeartbeatAt, "2026-03-01T10:00:00Z");
    assert.equal(record.completedAt, null);
    assert.equal(record.durationMs, null);
    assert.equal(record.result, null);
    assert.equal(record.error, null);
    assert.equal(record.reason, null);
    assert.equal(record.progress, "");
  });

  it("should update on AgentHeartbeatReceived", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "claude-code", "task-1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentHeartbeatReceived("p1", "50% done", "2026-03-01T10:01:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.lastHeartbeatAt, "2026-03-01T10:01:00Z");
    assert.equal(record.progress, "50% done");
    assert.equal(record.status, "running"); // starting -> running on heartbeat
  });

  it("should update on AgentCompleted", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "claude-code", "task-1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentCompleted("p1", "task-1", { files: 3 }, "2026-03-01T10:05:00Z", 300_000));

    const record = store.get("p1")!;
    assert.equal(record.status, "completed");
    assert.deepEqual(record.result, { files: 3 });
    assert.equal(record.completedAt, "2026-03-01T10:05:00Z");
    assert.equal(record.durationMs, 300_000);
  });

  it("should update on AgentFailed", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "claude-code", "task-1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentFailed("p1", "task-1", "Process crashed", "2026-03-01T10:02:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "failed");
    assert.equal(record.error, "Process crashed");
    assert.equal(record.completedAt, "2026-03-01T10:02:00Z");
    assert.equal(record.durationMs, 120_000);
  });

  it("should update on AgentHung", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "claude-code", "task-1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentHung("p1", "task-1", "2026-03-01T10:00:00Z", "2026-03-01T10:02:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "hung");
    assert.equal(record.lastHeartbeatAt, "2026-03-01T10:00:00Z");
  });

  it("should update on AgentKilled", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "claude-code", "task-1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentKilled("p1", "task-1", "hung - no heartbeat", "2026-03-01T10:03:00Z"));

    const record = store.get("p1")!;
    assert.equal(record.status, "killed");
    assert.equal(record.reason, "hung - no heartbeat");
    assert.equal(record.completedAt, "2026-03-01T10:03:00Z");
    assert.equal(record.durationMs, 180_000);
  });

  it("should replay a full lifecycle", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "claude-code", "task-1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentHeartbeatReceived("p1", "working...", "2026-03-01T10:01:00Z"));
    store.apply(new AgentHeartbeatReceived("p1", "almost done", "2026-03-01T10:02:00Z"));
    store.apply(new AgentCompleted("p1", "task-1", "success", "2026-03-01T10:03:00Z", 180_000));

    const record = store.get("p1")!;
    assert.equal(record.status, "completed");
    assert.equal(record.progress, "almost done");
    assert.equal(record.durationMs, 180_000);
  });

  it("should filter by status", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "agent-a", "t1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentCompleted("p1", "t1", null, "2026-03-01T10:05:00Z", 300_000));
    store.apply(new AgentSpawned("p2", "agent-b", "t2", "2026-03-01T10:00:00Z"));
    store.apply(new AgentFailed("p2", "t2", "err", "2026-03-01T10:01:00Z"));
    store.apply(new AgentSpawned("p3", "agent-a", "t3", "2026-03-01T10:00:00Z"));

    assert.equal(store.list({ status: "completed" }).length, 1);
    assert.equal(store.list({ status: "failed" }).length, 1);
    assert.equal(store.list({ status: "starting" }).length, 1);
  });

  it("should filter by agentName", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "agent-a", "t1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentSpawned("p2", "agent-b", "t2", "2026-03-01T10:00:00Z"));
    store.apply(new AgentSpawned("p3", "agent-a", "t3", "2026-03-01T10:00:00Z"));

    assert.equal(store.list({ agentName: "agent-a" }).length, 2);
    assert.equal(store.list({ agentName: "agent-b" }).length, 1);
  });

  it("should filter by taskId", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "agent-a", "t1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentSpawned("p2", "agent-b", "t1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentSpawned("p3", "agent-a", "t2", "2026-03-01T10:00:00Z"));

    assert.equal(store.list({ taskId: "t1" }).length, 2);
  });

  it("should return running processes via getRunning()", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "a", "t1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentHeartbeatReceived("p1", "working", "2026-03-01T10:01:00Z")); // now running
    store.apply(new AgentSpawned("p2", "b", "t2", "2026-03-01T10:00:00Z")); // still starting
    store.apply(new AgentSpawned("p3", "c", "t3", "2026-03-01T10:00:00Z"));
    store.apply(new AgentCompleted("p3", "t3", null, "2026-03-01T10:05:00Z", 300_000));

    const running = store.getRunning();
    assert.equal(running.length, 2); // p1 (running) + p2 (starting)
  });

  it("should return hung processes via getHung()", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "a", "t1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentHung("p1", "t1", "2026-03-01T10:00:00Z", "2026-03-01T10:02:00Z"));
    store.apply(new AgentSpawned("p2", "b", "t2", "2026-03-01T10:00:00Z"));

    assert.equal(store.getHung().length, 1);
    assert.equal(store.getHung()[0].processId, "p1");
  });

  it("should report utilization summary", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "a", "t1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentHeartbeatReceived("p1", "", "2026-03-01T10:01:00Z"));
    store.apply(new AgentSpawned("p2", "b", "t2", "2026-03-01T10:00:00Z"));
    store.apply(new AgentCompleted("p2", "t2", null, "2026-03-01T10:05:00Z", 300_000));
    store.apply(new AgentSpawned("p3", "c", "t3", "2026-03-01T10:00:00Z"));
    store.apply(new AgentFailed("p3", "t3", "err", "2026-03-01T10:01:00Z"));
    store.apply(new AgentSpawned("p4", "d", "t4", "2026-03-01T10:00:00Z"));
    store.apply(new AgentKilled("p4", "t4", "manual", "2026-03-01T10:02:00Z"));

    const util = store.utilization();
    assert.equal(util.total, 4);
    assert.equal(util.running, 1);
    assert.equal(util.completed, 1);
    assert.equal(util.failed, 1);
    assert.equal(util.killed, 1);
  });

  it("should return undefined for unknown processId", () => {
    const store = makeStore();
    assert.equal(store.get("nonexistent"), undefined);
  });

  it("should ignore events for unknown processId", () => {
    const store = makeStore();
    store.apply(new AgentHeartbeatReceived("unknown", "progress", "2026-03-01T10:00:00Z"));
    assert.equal(store.getAll().length, 0);
  });

  it("should support pagination", () => {
    const store = makeStore();
    store.apply(new AgentSpawned("p1", "a", "t1", "2026-03-01T10:00:00Z"));
    store.apply(new AgentSpawned("p2", "b", "t2", "2026-03-01T10:00:00Z"));
    store.apply(new AgentSpawned("p3", "c", "t3", "2026-03-01T10:00:00Z"));

    const page = store.list({ limit: 2, offset: 1 });
    assert.equal(page.length, 2);
    assert.equal(page[0].processId, "p2");
    assert.equal(page[1].processId, "p3");
  });
});
