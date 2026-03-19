import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { dashboardRouter } from "./dashboard-router";
import { HealthAggregator } from "../../monitoring/health-aggregator";
import { AlertEngine } from "../../monitoring/alert-engine";
import { MetricsCollector } from "../../monitoring/metrics";

// Minimal HTTP test helper - sends request to express app
async function request(
  app: express.Application,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        throw new Error("Failed to get server address");
      }
      const port = address.port;
      const url = `http://127.0.0.1:${port}${path}`;

      const options: RequestInit = { method };
      if (body) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(body);
      }

      fetch(url, options)
        .then(async (res) => {
          const json = await res.json().catch(() => null);
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => {
          server.close();
          throw err;
        });
    });
  });
}

function makeApp() {
  const metrics = new MetricsCollector();
  const alertEngine = new AlertEngine();
  const healthAggregator = new HealthAggregator({ metrics, alertEngine });

  const app = express();
  app.use(express.json());
  app.use(dashboardRouter({ healthAggregator, alertEngine, metrics }));

  return { app, metrics, alertEngine, healthAggregator };
}

describe("DashboardRouter", () => {
  it("GET /api/dashboard returns system health", async () => {
    const { app } = makeApp();
    const res = await request(app, "GET", "/api/dashboard");

    assert.equal(res.status, 200);
    assert.ok(res.body.timestamp);
    assert.equal(res.body.overall, "healthy");
    assert.ok("uptime" in res.body);
    assert.ok("activeAgents" in res.body);
    assert.ok("queuedTasks" in res.body);
    assert.ok("completedTasks24h" in res.body);
    assert.ok("failedTasks24h" in res.body);
    assert.ok("successRate24h" in res.body);
    assert.ok(Array.isArray(res.body.components));
    assert.ok(Array.isArray(res.body.connectorHealth));
    assert.ok(Array.isArray(res.body.alerts));
  });

  it("GET /api/dashboard/alerts returns active alerts", async () => {
    const { app, alertEngine } = makeApp();

    // Create an alert
    alertEngine.addRule({
      id: "r1",
      name: "Test Alert",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">=", value: 0 },
      severity: "warning",
      cooldownMs: 0,
      enabled: true,
    });
    alertEngine.evaluate({
      overall: "healthy",
      components: [],
      activeAgents: 0,
      queuedTasks: 5,
      completedTasks24h: 10,
      failedTasks24h: 0,
      successRate24h: 1,
      avgTaskDurationMs: 0,
      connectorHealth: [],
    });

    const res = await request(app, "GET", "/api/dashboard/alerts");

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].title, "Test Alert");
  });

  it("POST /api/dashboard/alerts/:id/acknowledge acknowledges alert", async () => {
    const { app, alertEngine } = makeApp();

    alertEngine.addRule({
      id: "r1",
      name: "Test Alert",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">=", value: 0 },
      severity: "warning",
      cooldownMs: 0,
      enabled: true,
    });
    const alerts = alertEngine.evaluate({
      overall: "healthy",
      components: [],
      activeAgents: 0,
      queuedTasks: 5,
      completedTasks24h: 10,
      failedTasks24h: 0,
      successRate24h: 1,
      avgTaskDurationMs: 0,
      connectorHealth: [],
    });

    const alertId = alerts[0].id;
    const res = await request(app, "POST", `/api/dashboard/alerts/${alertId}/acknowledge`);

    assert.equal(res.status, 200);
    assert.equal(res.body.acknowledged, true);

    // Verify it's acknowledged
    const active = alertEngine.getActive();
    assert.ok(active[0].acknowledgedAt !== null);
  });

  it("POST /api/dashboard/alerts/:id/acknowledge returns 404 for unknown alert", async () => {
    const { app } = makeApp();
    const res = await request(app, "POST", "/api/dashboard/alerts/nonexistent/acknowledge");
    assert.equal(res.status, 404);
  });

  it("GET /api/dashboard/metrics returns metric data", async () => {
    const { app, metrics } = makeApp();

    metrics.record("tasks.completed", 10);
    metrics.record("tasks.failed", 2);

    const res = await request(app, "GET", "/api/dashboard/metrics");

    assert.equal(res.status, 200);
    assert.ok(res.body["tasks.completed"]);
    assert.ok(res.body["tasks.failed"]);
  });

  it("GET /api/dashboard/metrics?metric=X returns single metric", async () => {
    const { app, metrics } = makeApp();

    metrics.record("tasks.completed", 10);
    metrics.record("tasks.failed", 2);

    const res = await request(app, "GET", "/api/dashboard/metrics?metric=tasks.completed");

    assert.equal(res.status, 200);
    assert.ok(res.body["tasks.completed"]);
    assert.equal(res.body["tasks.failed"], undefined);
  });

  it("GET /api/dashboard/timeline returns events", async () => {
    const { app, alertEngine, metrics } = makeApp();

    // Create alert for timeline
    alertEngine.addRule({
      id: "r1",
      name: "Timeline Test",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">=", value: 0 },
      severity: "info",
      cooldownMs: 0,
      enabled: true,
    });
    alertEngine.evaluate({
      overall: "healthy",
      components: [],
      activeAgents: 0,
      queuedTasks: 1,
      completedTasks24h: 0,
      failedTasks24h: 0,
      successRate24h: 1,
      avgTaskDurationMs: 0,
      connectorHealth: [],
    });

    // Add metric data points
    metrics.record("tasks.completed", 5);

    const res = await request(app, "GET", "/api/dashboard/timeline");

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);

    // Should be sorted by timestamp descending
    for (let i = 1; i < res.body.length; i++) {
      assert.ok(
        new Date(res.body[i - 1].timestamp).getTime() >= new Date(res.body[i].timestamp).getTime()
      );
    }
  });

  it("GET /api/dashboard/timeline respects limit", async () => {
    const { app, metrics } = makeApp();

    metrics.record("tasks.completed", 1);
    metrics.record("tasks.completed", 2);
    metrics.record("tasks.completed", 3);

    const res = await request(app, "GET", "/api/dashboard/timeline?limit=2");

    assert.equal(res.status, 200);
    assert.ok(res.body.length <= 2);
  });
});
