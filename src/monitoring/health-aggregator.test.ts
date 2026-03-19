import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HealthAggregator } from "./health-aggregator";
import type { ComponentChecker } from "./health-aggregator";
import { AgentProcessStore } from "../read-models/agent-processes";
import { PipelineRunStore } from "../read-models/pipeline-run";
import { MetricsCollector } from "./metrics";
import { AlertEngine } from "./alert-engine";
import { AgentSpawned, AgentHeartbeatReceived, AgentHung } from "../domain/agent-process/events";
import { PipelineStarted, PipelineCompleted, PipelineFailed } from "../domain/issue-pipeline/events";
import { HealthCheckCompleted } from "../domain/monitoring/events";

function makeAgentStore(): AgentProcessStore {
  const store = new AgentProcessStore();
  store.apply(new AgentSpawned("p1", "coder", "t1", "2026-03-18T08:00:00Z"));
  store.apply(new AgentHeartbeatReceived("p1", "working", "2026-03-18T08:01:00Z"));
  return store;
}

function makePipelineStore(): PipelineRunStore {
  const store = new PipelineRunStore();
  const now = new Date().toISOString();
  store.apply(new PipelineStarted("pipe1", 1, "Fix bug", "fix/bug", now));
  store.apply(new PipelineCompleted("pipe1", now));
  store.apply(new PipelineStarted("pipe2", 2, "Add feature", "feat/add", now));
  store.apply(new PipelineFailed("pipe2", "Build error", now));
  return store;
}

describe("HealthAggregator", () => {
  it("should collect health with no dependencies", async () => {
    const agg = new HealthAggregator({});
    const health = await agg.collectHealth();

    assert.equal(health.overall, "healthy");
    assert.ok(health.timestamp);
    assert.ok(health.uptime >= 0);
    assert.equal(health.activeAgents, 0);
    assert.equal(health.queuedTasks, 0);
  });

  it("should aggregate agent metrics", async () => {
    const agentStore = makeAgentStore();
    const agg = new HealthAggregator({ agentStore });
    const health = await agg.collectHealth();

    assert.equal(health.activeAgents, 1);
  });

  it("should detect hung agents as degraded", async () => {
    const agentStore = new AgentProcessStore();
    agentStore.apply(new AgentSpawned("p1", "coder", "t1", "2026-03-18T08:00:00Z"));
    agentStore.apply(new AgentHung("p1", "2026-03-18T08:00:00Z", "2026-03-18T08:10:00Z"));

    const agg = new HealthAggregator({ agentStore });
    const health = await agg.collectHealth();

    // Should have an agents component with degraded status
    const agentComp = health.components.find(c => c.name === "agents");
    assert.ok(agentComp);
    assert.equal(agentComp!.status, "degraded");
    assert.equal(health.overall, "degraded");
  });

  it("should aggregate pipeline metrics", async () => {
    const pipelineStore = makePipelineStore();
    const agg = new HealthAggregator({ pipelineStore });
    const health = await agg.collectHealth();

    assert.equal(health.completedTasks24h, 1);
    assert.equal(health.failedTasks24h, 1);
    assert.equal(health.successRate24h, 0.5);
  });

  it("should check component health", async () => {
    const checkers: ComponentChecker[] = [
      {
        name: "task-router",
        check: () => ({
          name: "task-router",
          status: "healthy" as const,
          lastCheckAt: new Date().toISOString(),
          latencyMs: 5,
        }),
      },
      {
        name: "knowledge-store",
        check: () => ({
          name: "knowledge-store",
          status: "down" as const,
          lastCheckAt: new Date().toISOString(),
          details: "Connection refused",
        }),
      },
    ];

    const agg = new HealthAggregator({ componentCheckers: checkers });
    const health = await agg.collectHealth();

    assert.equal(health.components.length, 2);
    assert.equal(health.overall, "critical"); // 'down' component → critical
  });

  it("should derive overall = healthy when all components healthy", async () => {
    const checkers: ComponentChecker[] = [
      {
        name: "task-router",
        check: () => ({ name: "task-router", status: "healthy" as const, lastCheckAt: new Date().toISOString() }),
      },
      {
        name: "supervisor",
        check: () => ({ name: "supervisor", status: "healthy" as const, lastCheckAt: new Date().toISOString() }),
      },
    ];

    const agg = new HealthAggregator({ componentCheckers: checkers });
    const health = await agg.collectHealth();
    assert.equal(health.overall, "healthy");
  });

  it("should derive overall = degraded when any component degraded", async () => {
    const checkers: ComponentChecker[] = [
      {
        name: "task-router",
        check: () => ({ name: "task-router", status: "healthy" as const, lastCheckAt: new Date().toISOString() }),
      },
      {
        name: "supervisor",
        check: () => ({ name: "supervisor", status: "degraded" as const, lastCheckAt: new Date().toISOString() }),
      },
    ];

    const agg = new HealthAggregator({ componentCheckers: checkers });
    const health = await agg.collectHealth();
    assert.equal(health.overall, "degraded");
  });

  it("should check connectors", async () => {
    const connectors = [
      {
        name: "GitHub",
        healthCheck: async () => ({
          ok: true,
          connector: "GitHub",
          latencyMs: 120,
        }),
        listTickets: async () => ({ tickets: [], total: 0, page: 1, pageSize: 10, hasMore: false }),
        getTicket: async () => { throw new Error("not impl"); },
        getComments: async () => [],
        addComment: async () => { throw new Error("not impl"); },
        listAttachments: async () => [],
        downloadAttachment: async () => Buffer.from(""),
        uploadAttachment: async () => { throw new Error("not impl"); },
        updateTicket: async () => { throw new Error("not impl"); },
      },
    ];

    const agg = new HealthAggregator({ connectors: connectors as any });
    const health = await agg.collectHealth();

    assert.equal(health.connectorHealth.length, 1);
    assert.equal(health.connectorHealth[0].name, "GitHub");
    assert.equal(health.connectorHealth[0].status, "healthy");
    assert.equal(health.connectorHealth[0].latencyMs, 120);
  });

  it("should handle connector health check failure", async () => {
    const connectors = [
      {
        name: "Jira",
        healthCheck: async () => { throw new Error("timeout"); },
        listTickets: async () => ({ tickets: [], total: 0, page: 1, pageSize: 10, hasMore: false }),
        getTicket: async () => { throw new Error("not impl"); },
        getComments: async () => [],
        addComment: async () => { throw new Error("not impl"); },
        listAttachments: async () => [],
        downloadAttachment: async () => Buffer.from(""),
        uploadAttachment: async () => { throw new Error("not impl"); },
        updateTicket: async () => { throw new Error("not impl"); },
      },
    ];

    const agg = new HealthAggregator({ connectors: connectors as any });
    const health = await agg.collectHealth();

    assert.equal(health.connectorHealth[0].status, "down");
  });

  it("should record metrics when MetricsCollector is provided", async () => {
    const metrics = new MetricsCollector();
    const pipelineStore = makePipelineStore();
    const agg = new HealthAggregator({ metrics, pipelineStore });

    await agg.collectHealth();

    assert.ok(metrics.gauge("tasks.completed") !== null);
    assert.ok(metrics.gauge("tasks.failed") !== null);
  });

  it("should include alerts from AlertEngine", async () => {
    const alertEngine = new AlertEngine();
    alertEngine.addRule({
      id: "r1",
      name: "Test Alert",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">=", value: 0 },
      severity: "info",
      cooldownMs: 0,
      enabled: true,
    });

    // Pre-evaluate to create an active alert
    alertEngine.evaluate({
      overall: "healthy",
      components: [],
      activeAgents: 0,
      queuedTasks: 5,
      completedTasks24h: 0,
      failedTasks24h: 0,
      successRate24h: 1,
      avgTaskDurationMs: 0,
      connectorHealth: [],
    });

    const agg = new HealthAggregator({ alertEngine });
    const health = await agg.collectHealth();

    assert.equal(health.alerts.length, 1);
  });

  it("should emit HealthCheckCompleted event on poll", async () => {
    const agg = new HealthAggregator({});
    const events: unknown[] = [];
    agg.on("event", (e) => events.push(e));

    await agg.poll();

    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof HealthCheckCompleted);
  });

  it("should cache last health", async () => {
    const agg = new HealthAggregator({});
    assert.equal(agg.getLastHealth(), null);

    await agg.poll();
    const cached = agg.getLastHealth();
    assert.ok(cached);
    assert.ok(cached!.timestamp);
  });

  it("should handle component checker that throws", async () => {
    const checkers: ComponentChecker[] = [
      {
        name: "broken",
        check: () => { throw new Error("crash"); },
      },
    ];

    const agg = new HealthAggregator({ componentCheckers: checkers });
    const health = await agg.collectHealth();

    assert.equal(health.components[0].status, "down");
    assert.ok(health.components[0].details?.includes("crash"));
  });
});
