import { Router } from "express";
import type { HealthAggregator } from "../../monitoring/health-aggregator";
import type { AlertEngine } from "../../monitoring/alert-engine";
import type { MetricsCollector } from "../../monitoring/metrics";

export interface DashboardRouterDeps {
  healthAggregator: HealthAggregator;
  alertEngine: AlertEngine;
  metrics: MetricsCollector;
}

export function dashboardRouter(deps: DashboardRouterDeps): Router {
  const { healthAggregator, alertEngine, metrics } = deps;
  const router = Router();

  // GET /api/dashboard - full SystemHealth snapshot
  router.get("/api/dashboard", async (_req, res) => {
    try {
      const health = healthAggregator.getLastHealth() ?? (await healthAggregator.collectHealth());
      res.json(health);
    } catch (err) {
      res.status(500).json({ message: "Failed to collect health", error: String(err) });
    }
  });

  // GET /api/dashboard/metrics - time-series metrics
  router.get("/api/dashboard/metrics", (req, res) => {
    const metric = req.query.metric as string | undefined;
    const window = req.query.window as string | undefined;

    const now = Date.now();
    let startTime: string | undefined;

    if (window === "15min") {
      startTime = new Date(now - 15 * 60 * 1000).toISOString();
    } else if (window === "1h") {
      startTime = new Date(now - 60 * 60 * 1000).toISOString();
    } else {
      // Default: 24h
      startTime = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    }

    if (metric) {
      const points = metrics.query(metric, { startTime });
      res.json({ [metric]: points });
      return;
    }

    // Return all known metrics
    const allMetrics = [
      "tasks.queued", "tasks.completed", "tasks.failed",
      "tasks.duration_ms", "agents.active", "agents.hung",
    ];

    const result: Record<string, unknown> = {};
    for (const m of allMetrics) {
      const points = metrics.query(m, { startTime });
      if (points.length > 0) {
        result[m] = points;
      }
    }
    res.json(result);
  });

  // GET /api/dashboard/alerts - active alerts
  router.get("/api/dashboard/alerts", (_req, res) => {
    const active = alertEngine.getActive();
    res.json(active);
  });

  // POST /api/dashboard/alerts/:id/acknowledge - acknowledge alert
  router.post("/api/dashboard/alerts/:id/acknowledge", (req, res) => {
    const alertId = req.params.id;
    const all = alertEngine.getAll();
    const alert = all.find(a => a.id === alertId);
    if (!alert) {
      res.status(404).json({ message: "Alert not found" });
      return;
    }

    alertEngine.acknowledge(alertId);
    res.json({ acknowledged: true, alertId });
  });

  // GET /api/dashboard/timeline - recent events timeline
  router.get("/api/dashboard/timeline", (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const now = Date.now();
    const startTime = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const events: Array<{
      type: string;
      timestamp: string;
      details: Record<string, unknown>;
    }> = [];

    // Add alerts to timeline
    const allAlerts = alertEngine.getAll();
    for (const alert of allAlerts) {
      events.push({
        type: "alert.triggered",
        timestamp: alert.triggeredAt,
        details: {
          alertId: alert.id,
          severity: alert.severity,
          title: alert.title,
          component: alert.component,
        },
      });
      if (alert.acknowledgedAt) {
        events.push({
          type: "alert.acknowledged",
          timestamp: alert.acknowledgedAt,
          details: { alertId: alert.id, title: alert.title },
        });
      }
      if (alert.resolvedAt) {
        events.push({
          type: "alert.resolved",
          timestamp: alert.resolvedAt,
          details: { alertId: alert.id, title: alert.title },
        });
      }
    }

    // Add metrics data points as events (task completions/failures)
    const completedPoints = metrics.query("tasks.completed", { startTime });
    for (const p of completedPoints) {
      if (p.value > 0) {
        events.push({
          type: "tasks.completed",
          timestamp: p.timestamp,
          details: { count: p.value },
        });
      }
    }

    const failedPoints = metrics.query("tasks.failed", { startTime });
    for (const p of failedPoints) {
      if (p.value > 0) {
        events.push({
          type: "tasks.failed",
          timestamp: p.timestamp,
          details: { count: p.value },
        });
      }
    }

    // Sort by timestamp descending (most recent first)
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json(events.slice(0, limit));
  });

  return router;
}
