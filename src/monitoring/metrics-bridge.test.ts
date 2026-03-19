import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MetricsBridge } from "./metrics-bridge";
import { MetricsCollector } from "./metrics";
import { EventBus } from "../infra/event-bus";
import { TaskSubmitted, TaskCompleted, TaskFailed } from "../domain/task/events";
import { AgentSpawned, AgentCompleted, AgentFailed, AgentHung } from "../domain/agent-process/events";
import { DeploySucceeded, DeployFailed } from "../domain/deployment/events";
import { KnowledgeAdded, KnowledgeUsed } from "../domain/knowledge/events";
import { NotificationSent, NotificationFailed } from "../domain/notification/events";

describe("MetricsBridge", () => {
  let metrics: MetricsCollector;
  let eventBus: EventBus;
  let bridge: MetricsBridge;

  beforeEach(() => {
    metrics = new MetricsCollector();
    eventBus = new EventBus();
    bridge = new MetricsBridge(metrics, eventBus);
    bridge.connect();
  });

  it("should record tasks.queued on TaskSubmitted", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new TaskSubmitted("t1", "manual", "s1", {}, now, "normal", undefined, "Test", "", "code", now));
    assert.equal(metrics.gauge("tasks.queued"), 1);

    eventBus.emit("event", new TaskSubmitted("t2", "manual", "s2", {}, now, "normal", undefined, "Test2", "", "code", now));
    assert.equal(metrics.gauge("tasks.queued"), 2);
  });

  it("should record tasks.completed and decrement queued on TaskCompleted", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new TaskSubmitted("t1", "manual", "s1", {}, now, "normal", undefined, "Test", "", "code", now));
    eventBus.emit("event", new TaskCompleted("t1", { success: true }, now));

    assert.equal(metrics.gauge("tasks.queued"), 0);
    assert.equal(metrics.gauge("tasks.completed"), 1);
  });

  it("should record tasks.failed and decrement queued on TaskFailed", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new TaskSubmitted("t1", "manual", "s1", {}, now, "normal", undefined, "Test", "", "code", now));
    eventBus.emit("event", new TaskFailed("t1", "boom", now));

    assert.equal(metrics.gauge("tasks.queued"), 0);
    assert.equal(metrics.gauge("tasks.failed"), 1);
  });

  it("should track agents.active gauge on AgentSpawned/Completed/Failed", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new AgentSpawned("p1", "coder", "t1", now));
    assert.equal(metrics.gauge("agents.active"), 1);

    eventBus.emit("event", new AgentSpawned("p2", "coder", "t2", now));
    assert.equal(metrics.gauge("agents.active"), 2);

    eventBus.emit("event", new AgentCompleted("p1", "t1", {}, now, 500));
    assert.equal(metrics.gauge("agents.active"), 1);

    eventBus.emit("event", new AgentFailed("p2", "t2", "error", now));
    assert.equal(metrics.gauge("agents.active"), 0);
  });

  it("should record agents.hung on AgentHung", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new AgentHung("p1", "t1", now, now));
    assert.equal(metrics.gauge("agents.hung"), 1);
  });

  it("should record tasks.duration_ms on AgentCompleted", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new AgentCompleted("p1", "t1", {}, now, 1234));
    assert.equal(metrics.gauge("tasks.duration_ms"), 1234);
  });

  it("should record deploys.success and deploys.failed", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new DeploySucceeded("d1", true, now));
    assert.equal(metrics.gauge("deploys.success"), 1);

    eventBus.emit("event", new DeployFailed("d2", "error", now));
    assert.equal(metrics.gauge("deploys.failed"), 1);
  });

  it("should record knowledge.entries and knowledge.searches", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new KnowledgeAdded("k1", "pattern", "Title", "Content", { taskId: "t1", agentName: "coder", timestamp: now }, ["tag"], ["file.ts"], 0.9));
    assert.equal(metrics.gauge("knowledge.entries"), 1);

    eventBus.emit("event", new KnowledgeUsed("k1", "t1", now));
    assert.equal(metrics.gauge("knowledge.searches"), 1);
  });

  it("should record notifications.sent and notifications.failed", () => {
    const now = new Date().toISOString();
    eventBus.emit("event", new NotificationSent("n1", "slack", "user", "subject", now));
    assert.equal(metrics.gauge("notifications.sent"), 1);

    eventBus.emit("event", new NotificationFailed("n2", "email", "timeout", now));
    assert.equal(metrics.gauge("notifications.failed"), 1);
  });

  it("should disconnect and stop recording", () => {
    bridge.disconnect();
    const now = new Date().toISOString();
    eventBus.emit("event", new TaskSubmitted("t1", "manual", "s1", {}, now, "normal", undefined, "Test", "", "code", now));
    assert.equal(metrics.gauge("tasks.queued"), null);
  });

  it("should not double-connect", () => {
    bridge.connect(); // second call should be no-op
    const now = new Date().toISOString();
    eventBus.emit("event", new TaskSubmitted("t1", "manual", "s1", {}, now, "normal", undefined, "Test", "", "code", now));
    // Should still be 1, not 2
    assert.equal(metrics.gauge("tasks.queued"), 1);
  });
});
