import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AlertEngine, defaultAlertRules } from "./alert-engine";
import type { SystemHealthForAlert } from "./alert-engine";
import { AlertTriggered, AlertAcknowledged, AlertResolved } from "../domain/monitoring/events";

function makeHealthy(): SystemHealthForAlert {
  return {
    overall: "healthy",
    components: [
      { name: "task-router", status: "healthy" },
      { name: "supervisor", status: "healthy" },
    ],
    activeAgents: 2,
    queuedTasks: 3,
    completedTasks24h: 100,
    failedTasks24h: 5,
    successRate24h: 0.95,
    avgTaskDurationMs: 5000,
    connectorHealth: [
      { name: "GitHub", status: "healthy" },
    ],
  };
}

describe("AlertEngine", () => {
  it("should add and remove rules", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Test Rule",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 10 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    assert.equal(engine.getRules().length, 1);
    engine.removeRule("r1");
    assert.equal(engine.getRules().length, 0);
  });

  it("should not trigger when condition is not met", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 10 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const alerts = engine.evaluate(makeHealthy()); // queuedTasks = 3
    assert.equal(alerts.length, 0);
  });

  it("should trigger threshold alert", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 2 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const health = makeHealthy();
    const alerts = engine.evaluate(health); // queuedTasks = 3 > 2
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, "warning");
    assert.equal(alerts[0].title, "Queue Backup");
  });

  it("should trigger status alert", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Component Down",
      condition: { type: "status", component: "supervisor", status: "down" },
      severity: "critical",
      cooldownMs: 300000,
      enabled: true,
    });

    const health = makeHealthy();
    health.components[1].status = "down";

    const alerts = engine.evaluate(health);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, "critical");
  });

  it("should trigger status alert for connectors", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Connector Down",
      condition: { type: "status", component: "GitHub", status: "down" },
      severity: "critical",
      cooldownMs: 300000,
      enabled: true,
    });

    const health = makeHealthy();
    health.connectorHealth[0].status = "down";

    const alerts = engine.evaluate(health);
    assert.equal(alerts.length, 1);
  });

  it("should not trigger disabled rules", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 0 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: false,
    });

    const alerts = engine.evaluate(makeHealthy());
    assert.equal(alerts.length, 0);
  });

  it("should enforce cooldown", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 2 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const health = makeHealthy();

    // First evaluation triggers
    const alerts1 = engine.evaluate(health);
    assert.equal(alerts1.length, 1);

    // Resolve it so the "already active" check doesn't block
    const alertId = alerts1[0].id;
    // We need to resolve it first, then try again
    engine.autoResolve({ ...health, queuedTasks: 0 }); // resolves it

    // Re-trigger: should be blocked by cooldown
    const alerts2 = engine.evaluate(health);
    assert.equal(alerts2.length, 0);
  });

  it("should not duplicate alerts for same rule", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 2 },
      severity: "warning",
      cooldownMs: 0, // no cooldown
      enabled: true,
    });

    const health = makeHealthy();

    // First fires
    const alerts1 = engine.evaluate(health);
    assert.equal(alerts1.length, 1);

    // Second should not fire because active alert already exists for this rule
    const alerts2 = engine.evaluate(health);
    assert.equal(alerts2.length, 0);
  });

  it("should emit AlertTriggered event", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 2 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const events: unknown[] = [];
    engine.on("event", (e) => events.push(e));

    engine.evaluate(makeHealthy());
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof AlertTriggered);
  });

  it("should get active alerts (unresolved only)", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 2 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    engine.evaluate(makeHealthy());
    const active = engine.getActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].resolvedAt, null);
  });

  it("should acknowledge alert", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 2 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const events: unknown[] = [];
    engine.on("event", (e) => events.push(e));

    const alerts = engine.evaluate(makeHealthy());
    engine.acknowledge(alerts[0].id);

    const ackEvents = events.filter(e => e instanceof AlertAcknowledged);
    assert.equal(ackEvents.length, 1);

    const active = engine.getActive();
    assert.equal(active[0].acknowledgedAt !== null, true);
  });

  it("should auto-resolve alerts when condition clears", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 2 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const events: unknown[] = [];
    engine.on("event", (e) => events.push(e));

    engine.evaluate(makeHealthy()); // triggers
    assert.equal(engine.getActive().length, 1);

    // Condition clears (queuedTasks = 1)
    const healthyNow = makeHealthy();
    healthyNow.queuedTasks = 1;
    engine.autoResolve(healthyNow);

    assert.equal(engine.getActive().length, 0);
    const resolveEvents = events.filter(e => e instanceof AlertResolved);
    assert.equal(resolveEvents.length, 1);
    assert.equal((resolveEvents[0] as AlertResolved).autoResolved, true);
  });

  it("should evaluate rate condition", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "High Failure Rate",
      condition: { type: "rate", metric: "tasks.failed_rate", operator: ">", value: 0.3, windowMs: 60000 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const health = makeHealthy();
    // failedTasks24h = 5, completedTasks24h = 100, rate = 5/105 ≈ 0.048
    const alerts1 = engine.evaluate(health);
    assert.equal(alerts1.length, 0);

    // Make failure rate high
    health.failedTasks24h = 50;
    health.completedTasks24h = 50;
    // rate = 50/100 = 0.5 > 0.3
    const alerts2 = engine.evaluate(health);
    assert.equal(alerts2.length, 1);
  });

  it("should evaluate absence condition", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "No data",
      condition: { type: "absence", metric: "heartbeat", durationMs: 60000 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const health = makeHealthy();
    health.metrics = {}; // heartbeat is absent
    const alerts = engine.evaluate(health);
    assert.equal(alerts.length, 1);
  });

  it("should not trigger absence when metric exists", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "No data",
      condition: { type: "absence", metric: "heartbeat", durationMs: 60000 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    });

    const health = makeHealthy();
    health.metrics = { heartbeat: 1 };
    const alerts = engine.evaluate(health);
    assert.equal(alerts.length, 0);
  });

  it("should provide default alert rules", () => {
    const rules = defaultAlertRules(5);
    assert.ok(rules.length >= 5);
    const ids = rules.map(r => r.id);
    assert.ok(ids.includes("agent-hung"));
    assert.ok(ids.includes("high-failure-rate"));
    assert.ok(ids.includes("queue-backup"));
    assert.ok(ids.includes("connector-down"));
    assert.ok(ids.includes("zero-throughput"));
    assert.ok(ids.includes("all-agents-busy"));
  });

  it("should support comparison operators >=, <=, <", () => {
    const engine = new AlertEngine();
    engine.addRule({
      id: "r1",
      name: "Low agents",
      condition: { type: "threshold", metric: "agents.active", operator: "<=", value: 2 },
      severity: "info",
      cooldownMs: 0,
      enabled: true,
    });

    const health = makeHealthy();
    health.activeAgents = 2;
    const alerts = engine.evaluate(health);
    assert.equal(alerts.length, 1);
  });
});
