/**
 * Status Command.
 *
 * Shows current system state: running/stopped, active agents, task queue,
 * recent completions/failures, connector health, and uptime.
 */

import { createLogger } from "../infra/logger";
import type { TaskQueueStore, TaskQueueRecord } from "../read-models/task-queue";
import type { AgentProcessStore, AgentProcessRecord } from "../read-models/agent-processes";

const log = createLogger("status");

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY;
const fmt = {
  bold:  (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  dim:   (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  green: (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:   (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow:(s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:  (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemStatus {
  running: boolean;
  uptime: string;
  agents: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  tasks: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    escalated: number;
  };
  recentCompleted: TaskQueueRecord[];
  recentFailed: TaskQueueRecord[];
  activeAgents: AgentProcessRecord[];
}

// ---------------------------------------------------------------------------
// Fetch status from REST API
// ---------------------------------------------------------------------------

export async function fetchStatus(apiUrl: string): Promise<SystemStatus | null> {
  try {
    // Fetch task queue
    const tasksResp = await fetch(`${apiUrl}/api/tasks`);
    if (!tasksResp.ok) return null;
    const tasksData = await tasksResp.json() as { tasks: TaskQueueRecord[] };
    const tasks = tasksData.tasks ?? [];

    // Fetch supervisor info
    const agentsResp = await fetch(`${apiUrl}/api/supervisor/agents`);
    const agentsData = agentsResp.ok
      ? (await agentsResp.json() as { agents: AgentProcessRecord[]; utilization: { total: number; running: number; completed: number; failed: number } })
      : { agents: [] as AgentProcessRecord[], utilization: { total: 0, running: 0, completed: 0, failed: 0 } };

    // Fetch health
    const healthResp = await fetch(`${apiUrl}/api/dashboard/health`);
    const healthData = healthResp.ok
      ? (await healthResp.json() as { uptime?: string })
      : { uptime: "unknown" };

    const queued = tasks.filter((t: TaskQueueRecord) => t.status === "queued" || t.status === "assigned");
    const running = tasks.filter((t: TaskQueueRecord) => t.status === "running");
    const completed = tasks.filter((t: TaskQueueRecord) => t.status === "completed");
    const failed = tasks.filter((t: TaskQueueRecord) => t.status === "failed");
    const escalated = tasks.filter((t: TaskQueueRecord) => t.status === "escalated");

    const recentCompleted = completed.slice(-5).reverse();
    const recentFailed = failed.slice(-5).reverse();

    const activeAgents = (agentsData.agents ?? []).filter(
      (a: AgentProcessRecord) => a.status === "running" || a.status === "starting"
    );

    return {
      running: true,
      uptime: healthData.uptime ?? "unknown",
      agents: {
        total: agentsData.utilization?.total ?? 0,
        running: agentsData.utilization?.running ?? 0,
        completed: agentsData.utilization?.completed ?? 0,
        failed: agentsData.utilization?.failed ?? 0,
      },
      tasks: {
        queued: queued.length,
        running: running.length,
        completed: completed.length,
        failed: failed.length,
        escalated: escalated.length,
      },
      recentCompleted,
      recentFailed,
      activeAgents,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build status from in-memory stores (for direct use)
// ---------------------------------------------------------------------------

export function buildStatus(
  taskStore: TaskQueueStore,
  agentStore: AgentProcessStore,
  startedAt: Date,
): SystemStatus {
  const allTasks = taskStore.getAll();
  const utilization = agentStore.utilization();
  const activeAgents = agentStore.getRunning();

  const queued = allTasks.filter(t => t.status === "queued" || t.status === "assigned");
  const running = allTasks.filter(t => t.status === "running");
  const completed = allTasks.filter(t => t.status === "completed");
  const failed = allTasks.filter(t => t.status === "failed");
  const escalated = allTasks.filter(t => t.status === "escalated");

  const uptimeMs = Date.now() - startedAt.getTime();
  const uptimeSec = Math.floor(uptimeMs / 1000);
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  const uptime = `${h}h ${m}m ${s}s`;

  return {
    running: true,
    uptime,
    agents: {
      total: utilization.total,
      running: utilization.running,
      completed: utilization.completed,
      failed: utilization.failed,
    },
    tasks: {
      queued: queued.length,
      running: running.length,
      completed: completed.length,
      failed: failed.length,
      escalated: escalated.length,
    },
    recentCompleted: completed.slice(-5).reverse(),
    recentFailed: failed.slice(-5).reverse(),
    activeAgents,
  };
}

// ---------------------------------------------------------------------------
// Print status
// ---------------------------------------------------------------------------

export function printStatus(status: SystemStatus): void {
  log.info("");
  log.info(fmt.bold("TierZero System Status"));
  log.info(fmt.dim("─".repeat(50)));

  // Running state
  const stateStr = status.running ? fmt.green("RUNNING") : fmt.red("STOPPED");
  log.info(`  State:   ${stateStr}`);
  log.info(`  Uptime:  ${fmt.cyan(status.uptime)}`);

  // Agents
  log.info("");
  log.info(fmt.bold("  Agents"));
  log.info(`    Running:   ${status.agents.running}`);
  log.info(`    Completed: ${status.agents.completed}`);
  log.info(`    Failed:    ${status.agents.failed}`);
  log.info(`    Total:     ${status.agents.total}`);

  // Task queue
  log.info("");
  log.info(fmt.bold("  Task Queue"));
  log.info(`    Queued:    ${status.tasks.queued}`);
  log.info(`    Running:   ${status.tasks.running}`);
  log.info(`    Completed: ${fmt.green(String(status.tasks.completed))}`);
  log.info(`    Failed:    ${status.tasks.failed > 0 ? fmt.red(String(status.tasks.failed)) : "0"}`);
  log.info(`    Escalated: ${status.tasks.escalated}`);

  // Active agents
  if (status.activeAgents.length > 0) {
    log.info("");
    log.info(fmt.bold("  Active Agents"));
    for (const agent of status.activeAgents) {
      log.info(`    ${fmt.cyan(agent.agentName)} -> task ${agent.taskId} (${agent.progress || "running"})`);
    }
  }

  // Recent completions
  if (status.recentCompleted.length > 0) {
    log.info("");
    log.info(fmt.bold("  Recent Completions"));
    for (const task of status.recentCompleted) {
      const dur = task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : "?";
      log.info(`    ${fmt.green("OK")} ${task.title} ${fmt.dim(`(${dur})`)}`);
    }
  }

  // Recent failures
  if (status.recentFailed.length > 0) {
    log.info("");
    log.info(fmt.bold("  Recent Failures"));
    for (const task of status.recentFailed) {
      log.info(`    ${fmt.red("FAIL")} ${task.title}: ${fmt.dim(task.error ?? "unknown error")}`);
    }
  }

  log.info(fmt.dim("─".repeat(50)));
  log.info("");
}

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function cmdStatus(apiPort: number): Promise<void> {
  const apiUrl = `http://localhost:${apiPort}`;

  const status = await fetchStatus(apiUrl);
  if (!status) {
    log.info("");
    log.info(`  ${fmt.red("STOPPED")} — Orchestrator is not running on port ${apiPort}`);
    log.info(`  Start it with: ${fmt.cyan("npx tsx src/cli.ts orchestrate")}`);
    log.info("");
    return;
  }

  printStatus(status);
}
