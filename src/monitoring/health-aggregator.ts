import { EventEmitter } from "events";
import type { HealthCheckResult, TicketConnector } from "../connectors/connector";
import type { AgentProcessStore } from "../read-models/agent-processes";
import type { PipelineRunStore } from "../read-models/pipeline-run";
import type { MetricsCollector } from "./metrics";
import type { AlertEngine, ActiveAlert } from "./alert-engine";
import { HealthCheckCompleted } from "../domain/monitoring/events";

export interface ComponentHealth {
  name: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  lastCheckAt: string;
  details?: string;
  latencyMs?: number;
}

export interface ConnectorHealthSummary {
  name: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  lastCheckedAt: string;
}

export interface SystemHealth {
  timestamp: string;
  overall: "healthy" | "degraded" | "critical" | "unknown";
  uptime: number;
  components: ComponentHealth[];
  activeAgents: number;
  queuedTasks: number;
  completedTasks24h: number;
  failedTasks24h: number;
  successRate24h: number;
  avgTaskDurationMs: number;
  connectorHealth: ConnectorHealthSummary[];
  alerts: ActiveAlert[];
}

export interface ComponentChecker {
  name: string;
  check(): Promise<ComponentHealth> | ComponentHealth;
}

export interface HealthAggregatorDeps {
  agentStore?: AgentProcessStore;
  pipelineStore?: PipelineRunStore;
  connectors?: TicketConnector[];
  metrics?: MetricsCollector;
  alertEngine?: AlertEngine;
  componentCheckers?: ComponentChecker[];
  pollIntervalMs?: number;
}

export class HealthAggregator extends EventEmitter {
  private readonly startedAt = Date.now();
  private readonly deps: HealthAggregatorDeps;
  private readonly pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealth: SystemHealth | null = null;

  constructor(deps: HealthAggregatorDeps) {
    super();
    this.deps = deps;
    this.pollIntervalMs = deps.pollIntervalMs ?? 60000;
  }

  start(): void {
    if (this.pollTimer) return;
    // Run immediately, then on interval
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async poll(): Promise<SystemHealth> {
    const health = await this.collectHealth();
    this.lastHealth = health;
    this.emit(
      "event",
      new HealthCheckCompleted(health.overall, health.components.length, health.timestamp)
    );
    return health;
  }

  getLastHealth(): SystemHealth | null {
    return this.lastHealth ? { ...this.lastHealth } : null;
  }

  async collectHealth(): Promise<SystemHealth> {
    const now = new Date().toISOString();
    const components = await this.checkComponents();
    const connectorHealth = await this.checkConnectors();

    // Gather agent metrics
    const agentUtil = this.deps.agentStore?.utilization();
    const activeAgents = agentUtil?.running ?? 0;
    const hungAgents = agentUtil?.hung ?? 0;

    // Gather pipeline metrics (24h)
    const pipelineRecords = this.deps.pipelineStore?.getAll() ?? [];
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = pipelineRecords.filter(
      r => new Date(r.startedAt).getTime() >= twentyFourHoursAgo
    );
    const completed24h = recent.filter(r => r.status === "completed").length;
    const failed24h = recent.filter(r => r.status === "failed").length;
    const total24h = completed24h + failed24h;
    const successRate24h = total24h > 0 ? completed24h / total24h : 1;
    const avgDuration =
      recent.filter(r => r.durationMs !== null).length > 0
        ? recent
            .filter(r => r.durationMs !== null)
            .reduce((sum, r) => sum + r.durationMs!, 0) /
          recent.filter(r => r.durationMs !== null).length
        : 0;

    // Queued tasks: count pipelines that are 'started' (in progress, not yet completed)
    const queuedTasks = pipelineRecords.filter(r =>
      r.status === "started"
    ).length;

    // Add synthetic component for agents if any are hung
    if (hungAgents > 0) {
      const agentComponent = components.find(c => c.name === "agents");
      if (agentComponent) {
        agentComponent.status = "degraded";
        agentComponent.details = `${hungAgents} hung agent(s)`;
      } else {
        components.push({
          name: "agents",
          status: "degraded",
          lastCheckAt: now,
          details: `${hungAgents} hung agent(s)`,
        });
      }
    }

    // Add synthetic connector component if any connector is down
    const anyConnectorDown = connectorHealth.some(c => c.status === "down");
    if (anyConnectorDown) {
      const connComp = components.find(c => c.name === "connectors");
      if (connComp) {
        connComp.status = "down";
      } else {
        components.push({
          name: "connectors",
          status: "down",
          lastCheckAt: now,
          details: "One or more connectors are down",
        });
      }
    }

    const overall = this.deriveOverall(components);

    // Get alerts from engine
    const alerts = this.deps.alertEngine?.getActive() ?? [];

    const health: SystemHealth = {
      timestamp: now,
      overall,
      uptime: Date.now() - this.startedAt,
      components,
      activeAgents,
      queuedTasks,
      completedTasks24h: completed24h,
      failedTasks24h: failed24h,
      successRate24h,
      avgTaskDurationMs: avgDuration,
      connectorHealth,
      alerts,
    };

    // Record metrics
    if (this.deps.metrics) {
      const m = this.deps.metrics;
      m.record("tasks.queued", queuedTasks);
      m.record("tasks.completed", completed24h);
      m.record("tasks.failed", failed24h);
      m.record("agents.active", activeAgents);
      if (hungAgents > 0) m.record("agents.hung", hungAgents);
    }

    return health;
  }

  private async checkComponents(): Promise<ComponentHealth[]> {
    const checkers = this.deps.componentCheckers ?? [];
    const results: ComponentHealth[] = [];
    for (const checker of checkers) {
      try {
        const result = await checker.check();
        results.push(result);
      } catch (err) {
        results.push({
          name: checker.name,
          status: "down",
          lastCheckAt: new Date().toISOString(),
          details: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  private async checkConnectors(): Promise<ConnectorHealthSummary[]> {
    const connectors = this.deps.connectors ?? [];
    const results: ConnectorHealthSummary[] = [];

    for (const connector of connectors) {
      try {
        const result: HealthCheckResult = await connector.healthCheck();
        results.push({
          name: result.connector,
          status: result.ok ? "healthy" : "down",
          latencyMs: result.latencyMs,
          lastCheckedAt: new Date().toISOString(),
        });

        // Record connector metrics
        if (this.deps.metrics) {
          this.deps.metrics.record(`connectors.${result.connector}.latency_ms`, result.latencyMs);
          if (!result.ok) {
            this.deps.metrics.record(`connectors.${result.connector}.errors`, 1);
          }
        }
      } catch (err) {
        results.push({
          name: connector.name,
          status: "down",
          latencyMs: 0,
          lastCheckedAt: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  private deriveOverall(
    components: ComponentHealth[]
  ): "healthy" | "degraded" | "critical" | "unknown" {
    if (components.length === 0) return "healthy";

    const hasDown = components.some(c => c.status === "down");
    const hasDegraded = components.some(c => c.status === "degraded");
    const allUnknown = components.every(c => c.status === "unknown");

    if (allUnknown) return "unknown";
    if (hasDown) return "critical";
    if (hasDegraded) return "degraded";
    return "healthy";
  }
}
