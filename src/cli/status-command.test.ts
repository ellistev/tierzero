import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStatus, type SystemStatus } from "./status-command";
import { TaskQueueStore } from "../read-models/task-queue";
import { AgentProcessStore } from "../read-models/agent-processes";
import {
  TaskSubmitted,
  TaskAssigned,
  TaskStarted,
  TaskCompleted,
  TaskFailed,
} from "../domain/task/events";
import {
  AgentSpawned,
  AgentHeartbeatReceived,
} from "../domain/agent-process/events";

function makeTaskSubmitted(taskId: string, title: string, category = "code", priority = "normal"): TaskSubmitted {
  const now = new Date().toISOString();
  return new TaskSubmitted(taskId, "github", `gh-${taskId}`, {}, now, priority, undefined, title, "desc", category, now);
}

describe("status-command", () => {
  describe("buildStatus", () => {
    it("returns correct counts with empty stores", () => {
      const taskStore = new TaskQueueStore();
      const agentStore = new AgentProcessStore();
      const startedAt = new Date();

      const status = buildStatus(taskStore, agentStore, startedAt);

      assert.equal(status.running, true);
      assert.equal(status.tasks.queued, 0);
      assert.equal(status.tasks.running, 0);
      assert.equal(status.tasks.completed, 0);
      assert.equal(status.tasks.failed, 0);
      assert.equal(status.tasks.escalated, 0);
      assert.equal(status.agents.total, 0);
      assert.equal(status.agents.running, 0);
      assert.equal(status.activeAgents.length, 0);
      assert.equal(status.recentCompleted.length, 0);
      assert.equal(status.recentFailed.length, 0);
    });

    it("counts queued and completed tasks correctly", () => {
      const taskStore = new TaskQueueStore();
      const agentStore = new AgentProcessStore();
      const startedAt = new Date(Date.now() - 3600_000);

      // Add a queued task
      taskStore.apply(makeTaskSubmitted("task-1", "Fix bug"));

      // Add a completed task
      taskStore.apply(makeTaskSubmitted("task-2", "Add feature"));
      taskStore.apply(new TaskAssigned("task-2", "agent-1", new Date().toISOString()));
      taskStore.apply(new TaskStarted("task-2", new Date().toISOString()));
      taskStore.apply(new TaskCompleted("task-2", { ok: true }, new Date().toISOString()));

      const status = buildStatus(taskStore, agentStore, startedAt);

      assert.equal(status.tasks.queued, 1);
      assert.equal(status.tasks.completed, 1);
      assert.equal(status.recentCompleted.length, 1);
      assert.equal(status.recentCompleted[0].title, "Add feature");
    });

    it("counts failed tasks and shows them in recentFailed", () => {
      const taskStore = new TaskQueueStore();
      const agentStore = new AgentProcessStore();
      const startedAt = new Date();

      taskStore.apply(makeTaskSubmitted("task-3", "Deploy", "operations", "high"));
      taskStore.apply(new TaskAssigned("task-3", "agent-1", new Date().toISOString()));
      taskStore.apply(new TaskStarted("task-3", new Date().toISOString()));
      taskStore.apply(new TaskFailed("task-3", "timeout", new Date().toISOString()));

      const status = buildStatus(taskStore, agentStore, startedAt);

      assert.equal(status.tasks.failed, 1);
      assert.equal(status.recentFailed.length, 1);
      assert.equal(status.recentFailed[0].error, "timeout");
    });

    it("shows active agents from agent store", () => {
      const taskStore = new TaskQueueStore();
      const agentStore = new AgentProcessStore();
      const startedAt = new Date();

      agentStore.apply(new AgentSpawned("proc-1", "claude-agent", "task-1", new Date().toISOString()));
      agentStore.apply(new AgentHeartbeatReceived("proc-1", "working", new Date().toISOString()));

      const status = buildStatus(taskStore, agentStore, startedAt);

      assert.equal(status.agents.running, 1);
      assert.equal(status.agents.total, 1);
      assert.equal(status.activeAgents.length, 1);
      assert.equal(status.activeAgents[0].agentName, "claude-agent");
    });

    it("formats uptime correctly", () => {
      const taskStore = new TaskQueueStore();
      const agentStore = new AgentProcessStore();
      const startedAt = new Date(Date.now() - (1 * 3600_000 + 30 * 60_000 + 45_000));

      const status = buildStatus(taskStore, agentStore, startedAt);

      assert.ok(status.uptime.includes("1h"));
      assert.ok(status.uptime.includes("30m"));
      assert.ok(status.uptime.includes("45s"));
    });
  });
});
