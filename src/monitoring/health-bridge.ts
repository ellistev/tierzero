import type { ComponentChecker, ComponentHealth } from "./health-aggregator";
import type { AgentProcessStore } from "../read-models/agent-processes";
import type { TicketConnector } from "../connectors/connector";
import type { NotificationManager } from "../comms/notification-manager";
import type { Scheduler } from "../scheduler/scheduler";
import type { TaskRouter } from "../orchestrator/task-router";

export interface BuildComponentCheckersInput {
  router?: TaskRouter;
  supervisor?: { getProcesses?: () => unknown[] };
  agentStore?: AgentProcessStore;
  connectors?: TicketConnector[];
  notifier?: NotificationManager;
  scheduler?: Scheduler;
}

/**
 * Build ComponentChecker instances for all subsystems so that
 * HealthAggregator can poll their status.
 */
export function buildComponentCheckers(input: BuildComponentCheckersInput): ComponentChecker[] {
  const checkers: ComponentChecker[] = [];

  // task-router: always healthy if it exists
  if (input.router) {
    checkers.push({
      name: "task-router",
      check(): ComponentHealth {
        return {
          name: "task-router",
          status: "healthy",
          lastCheckAt: new Date().toISOString(),
          details: "Task router is running",
        };
      },
    });
  }

  // supervisor: degraded if any hung agents
  if (input.agentStore) {
    const agentStore = input.agentStore;
    checkers.push({
      name: "supervisor",
      check(): ComponentHealth {
        const util = agentStore.utilization();
        const status = util.hung > 0 ? "degraded" : "healthy";
        return {
          name: "supervisor",
          status,
          lastCheckAt: new Date().toISOString(),
          details: `running=${util.running} completed=${util.completed} failed=${util.failed} hung=${util.hung}`,
        };
      },
    });
  }

  // connectors: check each connector's healthCheck()
  if (input.connectors && input.connectors.length > 0) {
    const connectors = input.connectors;
    checkers.push({
      name: "connectors",
      async check(): Promise<ComponentHealth> {
        const start = Date.now();
        let allOk = true;
        const failed: string[] = [];

        for (const conn of connectors) {
          try {
            const result = await conn.healthCheck();
            if (!result.ok) {
              allOk = false;
              failed.push(conn.name);
            }
          } catch {
            allOk = false;
            failed.push(conn.name);
          }
        }

        return {
          name: "connectors",
          status: allOk ? "healthy" : "down",
          lastCheckAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
          details: allOk ? `${connectors.length} connector(s) healthy` : `Down: ${failed.join(", ")}`,
        };
      },
    });
  }

  // notification channels: check channel health
  if (input.notifier) {
    const notifier = input.notifier;
    checkers.push({
      name: "notifications",
      async check(): Promise<ComponentHealth> {
        const channels = notifier.getChannels();
        if (channels.length === 0) {
          return {
            name: "notifications",
            status: "healthy",
            lastCheckAt: new Date().toISOString(),
            details: "No channels configured",
          };
        }

        let allOk = true;
        const failed: string[] = [];

        for (const ch of channels) {
          try {
            const result = await ch.healthCheck();
            if (!result.ok) {
              allOk = false;
              failed.push(ch.name);
            }
          } catch {
            allOk = false;
            failed.push(ch.name);
          }
        }

        return {
          name: "notifications",
          status: allOk ? "healthy" : "degraded",
          lastCheckAt: new Date().toISOString(),
          details: allOk ? `${channels.length} channel(s) healthy` : `Unhealthy: ${failed.join(", ")}`,
        };
      },
    });
  }

  // scheduler: check if scheduler is running
  if (input.scheduler) {
    const scheduler = input.scheduler;
    checkers.push({
      name: "scheduler",
      check(): ComponentHealth {
        const jobs = scheduler.listJobs();
        const enabledCount = jobs.filter(j => j.enabled).length;
        return {
          name: "scheduler",
          status: "healthy",
          lastCheckAt: new Date().toISOString(),
          details: `${enabledCount}/${jobs.length} jobs enabled`,
        };
      },
    });
  }

  return checkers;
}
