import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { ConcurrencyManager } from "./concurrency";
import {
  AgentSpawned,
  AgentHeartbeatReceived,
  AgentCompleted,
  AgentFailed,
  AgentHung,
  AgentKilled,
} from "../domain/agent-process/events";
import type { NormalizedTask } from "./agent-registry";

// ── Interfaces ──────────────────────────────────────────────────────

export interface AgentHeartbeat {
  alive: boolean;
  progress: string;
  percentComplete: number | null;
}

export interface AgentContext {
  processId: string;
  workDir: string;
  reportProgress: (message: string) => void;
  reportHeartbeat: () => void;
}

export interface ManagedAgent {
  name: string;
  type: string;
  start(task: NormalizedTask, context: AgentContext): Promise<void>;
  heartbeat(): Promise<AgentHeartbeat>;
  stop(): Promise<void>;
  kill(): void;
}

export interface AgentProcess {
  processId: string;
  agentName: string;
  taskId: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'killed' | 'hung';
  pid: number | null;
  startedAt: string;
  lastHeartbeatAt: string;
  timeoutMs: number;
  memoryMb: number | null;
  output: string[];
}

export interface SupervisorConfig {
  maxTotalAgents: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  taskTimeoutMs: number;
  cleanupIntervalMs: number;
  workDirBase?: string;
  retainWorkDirs?: boolean;
}

const DEFAULT_CONFIG: SupervisorConfig = {
  maxTotalAgents: 5,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 120_000,
  taskTimeoutMs: 600_000,
  cleanupIntervalMs: 15_000,
};

const MAX_OUTPUT_LINES = 100;

// ── Supervisor ──────────────────────────────────────────────────────

export class AgentSupervisor extends EventEmitter {
  readonly config: SupervisorConfig;
  readonly concurrency: ConcurrencyManager;

  private agents = new Map<string, { managed: ManagedAgent; process: AgentProcess }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private workDirBase: string;

  constructor(config?: Partial<SupervisorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.concurrency = new ConcurrencyManager(this.config.maxTotalAgents);
    this.workDirBase = this.config.workDirBase ?? join(tmpdir(), "tierzero-work");
  }

  /** Start the cleanup/monitoring loop */
  start(): void {
    this.cleanupTimer = setInterval(() => this.checkAgents(), this.config.cleanupIntervalMs);
  }

  /** Spawn a managed agent for a task */
  async spawn(agent: ManagedAgent, task: NormalizedTask, timeoutMs?: number): Promise<AgentProcess | null> {
    if (this.shuttingDown) return null;
    if (!this.concurrency.acquire(agent.type)) return null;

    const processId = randomUUID();
    const now = new Date().toISOString();
    const workDir = join(this.workDirBase, task.taskId);

    // Create isolated work directory
    if (!existsSync(workDir)) {
      mkdirSync(workDir, { recursive: true });
    }

    const proc: AgentProcess = {
      processId,
      agentName: agent.name,
      taskId: task.taskId,
      status: 'starting',
      pid: null,
      startedAt: now,
      lastHeartbeatAt: now,
      timeoutMs: timeoutMs ?? this.config.taskTimeoutMs,
      memoryMb: null,
      output: [],
    };

    this.agents.set(processId, { managed: agent, process: proc });

    const event = new AgentSpawned(processId, agent.name, task.taskId, now);
    this.emit("event", event);

    const context: AgentContext = {
      processId,
      workDir,
      reportProgress: (message: string) => {
        this.appendOutput(processId, message);
      },
      reportHeartbeat: () => {
        this.recordHeartbeat(processId);
      },
    };

    // Start the agent asynchronously
    proc.status = 'running';
    agent.start(task, context).then(() => {
      this.completeAgent(processId, null);
    }).catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      this.failAgent(processId, error);
    });

    return proc;
  }

  /** Get a process by ID */
  getProcess(processId: string): AgentProcess | undefined {
    return this.agents.get(processId)?.process;
  }

  /** Get all processes */
  listProcesses(): AgentProcess[] {
    return [...this.agents.values()].map(a => a.process);
  }

  /** Get running processes */
  getRunning(): AgentProcess[] {
    return this.listProcesses().filter(p => p.status === 'running' || p.status === 'starting');
  }

  /** Get hung processes */
  getHung(): AgentProcess[] {
    return this.listProcesses().filter(p => p.status === 'hung');
  }

  /** Force-kill a specific agent */
  async killAgent(processId: string, reason: string): Promise<boolean> {
    const entry = this.agents.get(processId);
    if (!entry) return false;
    const { managed, process: proc } = entry;
    if (proc.status === 'completed' || proc.status === 'failed' || proc.status === 'killed') return false;

    managed.kill();
    proc.status = 'killed';
    this.concurrency.release(managed.type);

    const now = new Date().toISOString();
    this.emit("event", new AgentKilled(processId, proc.taskId, reason, now));
    this.cleanupWorkDir(proc.taskId);
    return true;
  }

  /** Graceful shutdown - wait for agents, then force-kill */
  async shutdown(timeoutMs?: number): Promise<void> {
    this.shuttingDown = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const running = this.getRunning();
    if (running.length === 0) return;

    // Ask all running agents to stop gracefully
    const stopPromises = running.map(async (proc) => {
      const entry = this.agents.get(proc.processId);
      if (entry) {
        try {
          await entry.managed.stop();
          this.completeAgent(proc.processId, null);
        } catch {
          // Will be force-killed below if timeout expires
        }
      }
    });

    const deadline = timeoutMs ?? this.config.taskTimeoutMs;
    const timer = new Promise<void>((resolve) => setTimeout(resolve, deadline));

    await Promise.race([Promise.allSettled(stopPromises), timer]);

    // Force-kill anything still running
    for (const proc of this.getRunning()) {
      await this.killAgent(proc.processId, "supervisor shutdown");
    }
    // Also kill hung agents
    for (const proc of this.getHung()) {
      await this.killAgent(proc.processId, "supervisor shutdown");
    }
  }

  // ── Internal ────────────────────────────────────────────────────

  private recordHeartbeat(processId: string): void {
    const entry = this.agents.get(processId);
    if (!entry) return;
    const now = new Date().toISOString();
    entry.process.lastHeartbeatAt = now;
    this.emit("event", new AgentHeartbeatReceived(processId, "", now));
  }

  private appendOutput(processId: string, line: string): void {
    const entry = this.agents.get(processId);
    if (!entry) return;
    entry.process.output.push(line);
    if (entry.process.output.length > MAX_OUTPUT_LINES) {
      entry.process.output.splice(0, entry.process.output.length - MAX_OUTPUT_LINES);
    }
  }

  private completeAgent(processId: string, result: unknown): void {
    const entry = this.agents.get(processId);
    if (!entry) return;
    if (entry.process.status === 'completed' || entry.process.status === 'failed' || entry.process.status === 'killed') return;

    const now = new Date().toISOString();
    const durationMs = Date.now() - new Date(entry.process.startedAt).getTime();
    entry.process.status = 'completed';
    this.concurrency.release(entry.managed.type);

    this.emit("event", new AgentCompleted(processId, entry.process.taskId, result, now, durationMs));
    this.cleanupWorkDir(entry.process.taskId);
  }

  private failAgent(processId: string, error: string): void {
    const entry = this.agents.get(processId);
    if (!entry) return;
    if (entry.process.status === 'completed' || entry.process.status === 'failed' || entry.process.status === 'killed') return;

    const now = new Date().toISOString();
    entry.process.status = 'failed';
    this.concurrency.release(entry.managed.type);

    this.emit("event", new AgentFailed(processId, entry.process.taskId, error, now));
    this.cleanupWorkDir(entry.process.taskId);
  }

  /** Check for hung and timed-out agents */
  private async checkAgents(): Promise<void> {
    const now = Date.now();
    for (const [processId, entry] of this.agents) {
      const { managed, process: proc } = entry;
      if (proc.status !== 'running' && proc.status !== 'starting') continue;

      // Check task timeout
      const elapsed = now - new Date(proc.startedAt).getTime();
      if (elapsed > proc.timeoutMs) {
        await this.killAgent(processId, "task timeout exceeded");
        continue;
      }

      // Check heartbeat timeout
      const sinceBeat = now - new Date(proc.lastHeartbeatAt).getTime();
      if (sinceBeat > this.config.heartbeatTimeoutMs) {
        proc.status = 'hung';
        this.emit("event", new AgentHung(processId, proc.taskId, proc.lastHeartbeatAt, new Date().toISOString()));

        // Try heartbeat check
        try {
          const hb = await managed.heartbeat();
          if (hb.alive) {
            proc.status = 'running';
            proc.lastHeartbeatAt = new Date().toISOString();
            this.emit("event", new AgentHeartbeatReceived(processId, hb.progress, proc.lastHeartbeatAt));
            continue;
          }
        } catch {
          // Agent not responding
        }

        // Force-kill hung agent
        await this.killAgent(processId, "agent hung - no heartbeat");
      }
    }
  }

  private cleanupWorkDir(taskId: string): void {
    if (this.config.retainWorkDirs) return;
    const dir = join(this.workDirBase, taskId);
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}
