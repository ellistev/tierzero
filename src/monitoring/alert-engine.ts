import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { AlertTriggered, AlertAcknowledged, AlertResolved } from "../domain/monitoring/events";

export interface ActiveAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  component: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  ruleId: string;
}

export type AlertCondition =
  | { type: "threshold"; metric: string; operator: ">" | "<" | ">=" | "<="; value: number }
  | { type: "status"; component: string; status: "degraded" | "down" }
  | { type: "absence"; metric: string; durationMs: number }
  | { type: "rate"; metric: string; operator: ">" | "<"; value: number; windowMs: number };

export interface AlertRule {
  id: string;
  name: string;
  condition: AlertCondition;
  severity: "critical" | "warning" | "info";
  cooldownMs: number;
  enabled: boolean;
}

export interface SystemHealthForAlert {
  overall: "healthy" | "degraded" | "critical" | "unknown";
  components: Array<{
    name: string;
    status: "healthy" | "degraded" | "down" | "unknown";
  }>;
  activeAgents: number;
  queuedTasks: number;
  completedTasks24h: number;
  failedTasks24h: number;
  successRate24h: number;
  avgTaskDurationMs: number;
  connectorHealth: Array<{
    name: string;
    status: "healthy" | "degraded" | "down";
  }>;
  // Metrics lookup for threshold/rate/absence conditions
  metrics?: Record<string, number | undefined>;
}

export class AlertEngine extends EventEmitter {
  private readonly rules = new Map<string, AlertRule>();
  private readonly activeAlerts = new Map<string, ActiveAlert>();
  private readonly lastFired = new Map<string, number>(); // ruleId -> timestamp

  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  getRules(): AlertRule[] {
    return [...this.rules.values()];
  }

  evaluate(health: SystemHealthForAlert): ActiveAlert[] {
    const newAlerts: ActiveAlert[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Cooldown check
      const lastFiredAt = this.lastFired.get(rule.id);
      if (lastFiredAt && now - lastFiredAt < rule.cooldownMs) continue;

      // Check if there's already an active (unresolved) alert for this rule
      const existingAlert = [...this.activeAlerts.values()].find(
        a => a.ruleId === rule.id && a.resolvedAt === null
      );
      if (existingAlert) continue;

      const triggered = this.evaluateCondition(rule.condition, health);
      if (!triggered) continue;

      const alert: ActiveAlert = {
        id: randomUUID(),
        severity: rule.severity,
        title: rule.name,
        description: this.describeCondition(rule.condition),
        component: this.getComponent(rule.condition),
        triggeredAt: new Date().toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
        ruleId: rule.id,
      };

      this.activeAlerts.set(alert.id, alert);
      this.lastFired.set(rule.id, now);
      newAlerts.push({ ...alert });

      this.emit(
        "event",
        new AlertTriggered(alert.id, rule.id, rule.severity, rule.name, alert.triggeredAt)
      );
    }

    return newAlerts;
  }

  getActive(): ActiveAlert[] {
    return [...this.activeAlerts.values()]
      .filter(a => a.resolvedAt === null)
      .map(a => ({ ...a }));
  }

  getAll(): ActiveAlert[] {
    return [...this.activeAlerts.values()].map(a => ({ ...a }));
  }

  acknowledge(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.acknowledgedAt) return;

    const now = new Date().toISOString();
    alert.acknowledgedAt = now;
    this.emit("event", new AlertAcknowledged(alertId, now));
  }

  autoResolve(health: SystemHealthForAlert): void {
    for (const alert of this.activeAlerts.values()) {
      if (alert.resolvedAt !== null) continue;

      const rule = this.rules.get(alert.ruleId);
      if (!rule) continue;

      const stillTriggered = this.evaluateCondition(rule.condition, health);
      if (!stillTriggered) {
        const now = new Date().toISOString();
        alert.resolvedAt = now;
        this.emit("event", new AlertResolved(alert.id, now, true));
      }
    }
  }

  private evaluateCondition(condition: AlertCondition, health: SystemHealthForAlert): boolean {
    switch (condition.type) {
      case "threshold": {
        const value = this.getMetricValue(condition.metric, health);
        if (value === undefined) return false;
        return this.compareValues(value, condition.operator, condition.value);
      }
      case "status": {
        // Check components
        const comp = health.components.find(c => c.name === condition.component);
        if (comp) return comp.status === condition.status;
        // Check connectors
        const conn = health.connectorHealth.find(c => c.name === condition.component);
        if (conn) return conn.status === condition.status;
        return false;
      }
      case "absence": {
        // Check if a metric has no data - use metrics lookup
        if (health.metrics) {
          return health.metrics[condition.metric] === undefined;
        }
        return false;
      }
      case "rate": {
        const value = this.getMetricValue(condition.metric, health);
        if (value === undefined) return false;
        return this.compareValues(value, condition.operator, condition.value);
      }
    }
  }

  private getMetricValue(metric: string, health: SystemHealthForAlert): number | undefined {
    // Check explicit metrics map first
    if (health.metrics && metric in health.metrics) {
      return health.metrics[metric];
    }

    // Map well-known metric names to health fields
    switch (metric) {
      case "tasks.queued": return health.queuedTasks;
      case "tasks.failed_rate":
        if (health.completedTasks24h + health.failedTasks24h === 0) return 0;
        return health.failedTasks24h / (health.completedTasks24h + health.failedTasks24h);
      case "tasks.completed": return health.completedTasks24h;
      case "tasks.failed": return health.failedTasks24h;
      case "agents.active": return health.activeAgents;
      case "tasks.duration_ms": return health.avgTaskDurationMs;
      case "tasks.success_rate": return health.successRate24h;
      default: return undefined;
    }
  }

  private compareValues(actual: number, operator: ">" | "<" | ">=" | "<=", expected: number): boolean {
    switch (operator) {
      case ">": return actual > expected;
      case "<": return actual < expected;
      case ">=": return actual >= expected;
      case "<=": return actual <= expected;
    }
  }

  private describeCondition(condition: AlertCondition): string {
    switch (condition.type) {
      case "threshold":
        return `Metric ${condition.metric} ${condition.operator} ${condition.value}`;
      case "status":
        return `Component ${condition.component} is ${condition.status}`;
      case "absence":
        return `No data for ${condition.metric} for ${condition.durationMs}ms`;
      case "rate":
        return `Rate ${condition.metric} ${condition.operator} ${condition.value} over ${condition.windowMs}ms`;
    }
  }

  private getComponent(condition: AlertCondition): string {
    switch (condition.type) {
      case "status": return condition.component;
      default: return condition.metric.split(".")[0];
    }
  }
}

export function defaultAlertRules(maxTotalAgents?: number): AlertRule[] {
  const rules: AlertRule[] = [
    {
      id: "agent-hung",
      name: "Agent Hung",
      condition: { type: "status", component: "agents", status: "degraded" },
      severity: "critical",
      cooldownMs: 300000,
      enabled: true,
    },
    {
      id: "high-failure-rate",
      name: "High Failure Rate",
      condition: { type: "threshold", metric: "tasks.failed_rate", operator: ">", value: 0.3 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    },
    {
      id: "queue-backup",
      name: "Queue Backup",
      condition: { type: "threshold", metric: "tasks.queued", operator: ">", value: 10 },
      severity: "warning",
      cooldownMs: 300000,
      enabled: true,
    },
    {
      id: "connector-down",
      name: "Connector Down",
      condition: { type: "status", component: "connectors", status: "down" },
      severity: "critical",
      cooldownMs: 300000,
      enabled: true,
    },
    {
      id: "zero-throughput",
      name: "Zero Throughput",
      condition: { type: "threshold", metric: "tasks.completed", operator: "<=", value: 0 },
      severity: "warning",
      cooldownMs: 7200000,
      enabled: true,
    },
  ];

  if (maxTotalAgents !== undefined) {
    rules.push({
      id: "all-agents-busy",
      name: "All Agents Busy",
      condition: { type: "threshold", metric: "agents.active", operator: ">=", value: maxTotalAgents },
      severity: "info",
      cooldownMs: 300000,
      enabled: true,
    });
  }

  return rules;
}
