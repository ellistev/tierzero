import type { EventBus } from "../infra/event-bus";
import type { MetricsCollector } from "./metrics";

import { TaskSubmitted, TaskCompleted, TaskFailed } from "../domain/task/events";
import { AgentSpawned, AgentCompleted, AgentFailed, AgentHung } from "../domain/agent-process/events";
import { DeploySucceeded, DeployFailed } from "../domain/deployment/events";
import { KnowledgeAdded, KnowledgeUsed } from "../domain/knowledge/events";
import { NotificationSent, NotificationFailed } from "../domain/notification/events";

/**
 * Subscribes to EventBus and records ALL domain events as metrics.
 */
export class MetricsBridge {
  private readonly metrics: MetricsCollector;
  private readonly eventBus: EventBus;
  private listener: ((event: unknown) => void) | null = null;

  // Gauges for active counts
  private tasksQueued = 0;
  private agentsActive = 0;

  constructor(metrics: MetricsCollector, eventBus: EventBus) {
    this.metrics = metrics;
    this.eventBus = eventBus;
  }

  connect(): void {
    if (this.listener) return;

    this.listener = (event: unknown) => {
      this.handleEvent(event);
    };

    this.eventBus.on("event", this.listener);
  }

  disconnect(): void {
    if (this.listener) {
      this.eventBus.removeListener("event", this.listener);
      this.listener = null;
    }
  }

  private handleEvent(event: unknown): void {
    if (event instanceof TaskSubmitted) {
      this.tasksQueued++;
      this.metrics.record("tasks.queued", this.tasksQueued);
    } else if (event instanceof TaskCompleted) {
      this.tasksQueued = Math.max(0, this.tasksQueued - 1);
      this.metrics.record("tasks.queued", this.tasksQueued);
      this.metrics.record("tasks.completed", 1);
    } else if (event instanceof TaskFailed) {
      this.tasksQueued = Math.max(0, this.tasksQueued - 1);
      this.metrics.record("tasks.queued", this.tasksQueued);
      this.metrics.record("tasks.failed", 1);
    } else if (event instanceof AgentSpawned) {
      this.agentsActive++;
      this.metrics.record("agents.active", this.agentsActive);
    } else if (event instanceof AgentCompleted) {
      this.agentsActive = Math.max(0, this.agentsActive - 1);
      this.metrics.record("agents.active", this.agentsActive);
      if (event.durationMs !== undefined) {
        this.metrics.record("tasks.duration_ms", event.durationMs);
      }
    } else if (event instanceof AgentFailed) {
      this.agentsActive = Math.max(0, this.agentsActive - 1);
      this.metrics.record("agents.active", this.agentsActive);
    } else if (event instanceof AgentHung) {
      this.metrics.record("agents.hung", 1);
    } else if (event instanceof DeploySucceeded) {
      this.metrics.record("deploys.success", 1);
    } else if (event instanceof DeployFailed) {
      this.metrics.record("deploys.failed", 1);
    } else if (event instanceof KnowledgeAdded) {
      this.metrics.record("knowledge.entries", 1);
    } else if (event instanceof KnowledgeUsed) {
      this.metrics.record("knowledge.searches", 1);
    } else if (event instanceof NotificationSent) {
      this.metrics.record("notifications.sent", 1);
    } else if (event instanceof NotificationFailed) {
      this.metrics.record("notifications.failed", 1);
    }
  }
}
