/**
 * ManagedAgent wrapper for OpenAI Codex CLI.
 *
 * Implements the ManagedAgent lifecycle interface so the AgentSupervisor
 * can spawn, monitor heartbeats, stop, and kill Codex processes.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import type { ManagedAgent, AgentContext, AgentHeartbeat } from "../orchestrator/supervisor";
import type { NormalizedTask } from "../orchestrator/agent-registry";

export interface ManagedCodexAgentConfig {
  codexPath?: string;
  timeoutMs?: number;
  model?: string;
}

export class ManagedCodexAgent implements ManagedAgent {
  readonly name: string;
  readonly type = "codex";

  private child: ChildProcess | null = null;
  private running = false;
  private readonly codexPath: string;
  private readonly timeoutMs: number;
  private readonly model: string;

  constructor(config?: ManagedCodexAgentConfig & { name?: string }) {
    this.name = config?.name ?? "codex";
    this.codexPath = config?.codexPath ?? "codex";
    this.timeoutMs = config?.timeoutMs ?? 600_000;
    this.model = config?.model ?? "gpt-5.4";
  }

  async start(task: NormalizedTask, context: AgentContext): Promise<void> {
    this.running = true;

    return new Promise((resolve, reject) => {
      const prompt = `Work on task: ${task.title}\n\n${task.description}`;

      let codexExe = this.codexPath;
      if (!/[\\/:]/.test(this.codexPath)) {
        try {
          codexExe = execSync(`where.exe ${this.codexPath}`, { encoding: "utf-8" }).trim().split("\n")[0].trim();
        } catch {
          // Fall back to configured path
        }
      }

      const args = [
        "exec",
        "--model",
        this.model,
        "--full-auto",
        prompt,
      ];

      const launch = prepareCodexLaunch(codexExe, args);
      this.child = spawn(launch.command, launch.args, {
        cwd: context.workDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
        detached: launch.detached,
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

      const timer = setTimeout(() => {
        try {
          if (this.child?.pid) {
            execSync(`taskkill /F /T /PID ${this.child.pid}`, { stdio: "pipe" });
          }
        } catch {
          try { this.child?.kill("SIGKILL"); } catch { /* ok */ }
        }
      }, this.timeoutMs);

      this.child.on("close", () => {
        clearTimeout(timer);
        this.running = false;
        this.child = null;
        resolve();
      });

      this.child.on("error", (err) => {
        clearTimeout(timer);
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
      progress: alive ? "Codex is running" : "Process not running",
      percentComplete: null,
    };
  }

  async stop(): Promise<void> {
    if (this.child && !this.child.killed) {
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

function prepareCodexLaunch(executable: string, args: string[]): { command: string; args: string[]; detached: boolean } {
  const lower = executable.toLowerCase();

  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    const comspec = process.env.ComSpec ?? "cmd.exe";
    const commandLine = [quoteForCmd(executable), ...args.map(quoteForCmd)].join(" ");
    return {
      command: comspec,
      args: ["/d", "/s", "/c", commandLine],
      detached: false,
    };
  }

  if (lower.endsWith(".ps1")) {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable, ...args],
      detached: false,
    };
  }

  return {
    command: executable,
    args,
    detached: true,
  };
}

function quoteForCmd(value: string): string {
  if (/^[A-Za-z0-9_:\\.\/-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
