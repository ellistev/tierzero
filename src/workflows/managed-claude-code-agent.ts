/**
 * ManagedAgent wrapper for ClaudeCodeAgent.
 *
 * Implements the ManagedAgent lifecycle interface so the AgentSupervisor
 * can spawn, monitor heartbeats, stop, and kill Claude Code processes.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import type { ManagedAgent, AgentContext, AgentHeartbeat } from "../orchestrator/supervisor";
import type { NormalizedTask } from "../orchestrator/agent-registry";

export interface ManagedClaudeCodeAgentConfig {
  claudePath?: string;
  timeoutMs?: number;
}

export class ManagedClaudeCodeAgent implements ManagedAgent {
  readonly name: string;
  readonly type = "claude-code";

  private child: ChildProcess | null = null;
  private context: AgentContext | null = null;
  private running = false;
  private readonly claudePath: string;
  private readonly timeoutMs: number;

  constructor(config?: ManagedClaudeCodeAgentConfig & { name?: string }) {
    this.name = config?.name ?? "claude-code";
    this.claudePath = config?.claudePath ?? "claude";
    this.timeoutMs = config?.timeoutMs ?? 600_000;
  }

  async start(task: NormalizedTask, context: AgentContext): Promise<void> {
    this.context = context;
    this.running = true;

    return new Promise((resolve, reject) => {
      const prompt = `Work on task: ${task.title}\n\n${task.description}`;

      // Resolve full path to claude binary
      let claudeExe = this.claudePath;
      try {
        claudeExe = execSync(`where.exe ${this.claudePath}`, { encoding: "utf-8" }).trim().split("\n")[0].trim();
      } catch {
        // Fall back to configured path
      }

      const args = [
        "--permission-mode", "bypassPermissions",
        "--print",
        prompt,
      ];

      this.child = spawn(claudeExe, args, {
        cwd: context.workDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
        detached: true,
        windowsHide: true,
      });

      this.child.stdout?.on("data", (buf: Buffer) => {
        const text = buf.toString();
        context.reportProgress(text);
        context.reportHeartbeat();
      });

      this.child.stderr?.on("data", (buf: Buffer) => {
        context.reportProgress(`[stderr] ${buf.toString()}`);
      });

      this.child.on("close", (code) => {
        this.running = false;
        this.child = null;
        if (code === 0) {
          resolve();
        } else {
          resolve(); // Resolve even on non-zero - Claude may have made changes
        }
      });

      this.child.on("error", (err) => {
        this.running = false;
        this.child = null;
        reject(err);
      });
    });
  }

  async heartbeat(): Promise<AgentHeartbeat> {
    const alive = this.running && this.child !== null && !this.child.killed;
    return {
      alive,
      progress: alive ? "Claude Code is running" : "Process not running",
      percentComplete: null,
    };
  }

  async stop(): Promise<void> {
    if (this.child && !this.child.killed) {
      // On Windows, use taskkill for detached processes
      try {
        execSync(`taskkill /F /T /PID ${this.child.pid}`, { stdio: "pipe" });
      } catch {
        try { this.child.kill("SIGINT"); } catch { /* ok */ }
      }
    }
    this.running = false;
    this.child = null;
  }

  kill(): void {
    if (this.child && !this.child.killed) {
      try {
        execSync(`taskkill /F /T /PID ${this.child.pid}`, { stdio: "pipe" });
      } catch {
        try { this.child.kill("SIGKILL"); } catch { /* ok */ }
      }
    }
    this.running = false;
    this.child = null;
  }
}
