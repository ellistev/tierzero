import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { nextRun, matches } from "./cron";
import {
  JobRegistered,
  JobTriggered,
  JobRunCompleted,
  JobRunFailed,
  JobDisabled,
  JobEnabled,
} from "../domain/scheduled-job/events";

export interface ScheduledJob {
  id: string;
  name: string;
  description: string;
  schedule: string;
  timezone?: string;
  taskTemplate: {
    title: string;
    description: string;
    category: "code" | "communication" | "research" | "operations" | "monitoring";
    priority: "critical" | "high" | "normal" | "low";
    agentType?: string;
  };
  enabled: boolean;
  maxConcurrent: number;
  catchUp: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  failCount: number;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
}

export type JobInput = Omit<ScheduledJob, "lastRunAt" | "nextRunAt" | "runCount" | "failCount" | "consecutiveFailures">;

export class Scheduler extends EventEmitter {
  private jobs = new Map<string, ScheduledJob>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private activeRuns = new Map<string, number>();
  private runIds = new Map<string, string>();

  onTrigger: (job: ScheduledJob) => Promise<void> = async () => {};

  addJob(input: JobInput): void {
    const job: ScheduledJob = {
      ...input,
      lastRunAt: null,
      nextRunAt: null,
      runCount: 0,
      failCount: 0,
      consecutiveFailures: 0,
    };
    if (job.enabled) {
      try {
        job.nextRunAt = nextRun(job.schedule).toISOString();
      } catch { /* invalid cron */ }
    }
    this.jobs.set(job.id, job);
    this.activeRuns.set(job.id, 0);

    this.emit("event", new JobRegistered(
      job.id, job.name, job.schedule, { ...job.taskTemplate },
      job.description, job.timezone ?? "UTC", job.enabled,
      job.maxConcurrent, job.catchUp, job.maxConsecutiveFailures,
      new Date().toISOString()
    ));
  }

  removeJob(jobId: string): void {
    this.jobs.delete(jobId);
    this.activeRuns.delete(jobId);
  }

  enableJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.enabled = true;
    job.consecutiveFailures = 0;
    try {
      job.nextRunAt = nextRun(job.schedule).toISOString();
    } catch { /* invalid cron */ }
    this.emit("event", new JobEnabled(job.id, new Date().toISOString()));
  }

  disableJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.enabled = false;
    job.nextRunAt = null;
    this.emit("event", new JobDisabled(job.id, "manually disabled", new Date().toISOString()));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Check every second for jobs that need to fire
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getJob(jobId: string): ScheduledJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  listJobs(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  async runNow(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    await this.fireJob(job);
  }

  /** Get the current run ID for a job (set during fireJob) */
  getRunId(jobId: string): string | undefined {
    return this.runIds.get(jobId);
  }

  /** Record that a job run completed successfully */
  recordSuccess(jobId: string, runId?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.runCount++;
    job.consecutiveFailures = 0;
    const active = this.activeRuns.get(jobId) ?? 0;
    this.activeRuns.set(jobId, Math.max(0, active - 1));

    const rid = runId ?? this.runIds.get(jobId) ?? randomUUID();
    this.emit("event", new JobRunCompleted(jobId, rid, null, new Date().toISOString()));
  }

  /** Record that a job run failed */
  recordFailure(jobId: string, error?: string, runId?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.runCount++;
    job.failCount++;
    job.consecutiveFailures++;
    const active = this.activeRuns.get(jobId) ?? 0;
    this.activeRuns.set(jobId, Math.max(0, active - 1));

    const rid = runId ?? this.runIds.get(jobId) ?? randomUUID();
    this.emit("event", new JobRunFailed(jobId, rid, error ?? "unknown", new Date().toISOString()));

    if (job.consecutiveFailures >= job.maxConsecutiveFailures) {
      job.enabled = false;
      job.nextRunAt = null;
      this.emit("event", new JobDisabled(jobId, `auto-disabled after ${job.consecutiveFailures} consecutive failures`, new Date().toISOString()));
    }
  }

  private tick(): void {
    const now = new Date();
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (!job.nextRunAt) continue;

      const nextRunTime = new Date(job.nextRunAt);
      if (now >= nextRunTime) {
        // Check maxConcurrent
        const active = this.activeRuns.get(job.id) ?? 0;
        if (active >= job.maxConcurrent) continue;

        this.fireJob(job);
      }
    }
  }

  private async fireJob(job: ScheduledJob): Promise<void> {
    const active = this.activeRuns.get(job.id) ?? 0;
    this.activeRuns.set(job.id, active + 1);
    job.lastRunAt = new Date().toISOString();

    const runId = randomUUID();
    this.runIds.set(job.id, runId);

    // Emit triggered event
    this.emit("event", new JobTriggered(job.id, job.lastRunAt, runId));

    // Recalculate next run
    try {
      job.nextRunAt = nextRun(job.schedule).toISOString();
    } catch { /* leave as is */ }

    try {
      await this.onTrigger(job);
    } catch {
      // Error handling is done externally via recordSuccess/recordFailure
    }
  }
}
