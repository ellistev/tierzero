import {
  JobRegistered,
  JobTriggered,
  JobRunCompleted,
  JobRunFailed,
  JobDisabled,
  JobEnabled,
  type ScheduledJobEvent,
} from "../domain/scheduled-job/events";
import { nextRun } from "../scheduler/cron";

export interface RunHistoryEntry {
  runId: string;
  status: "running" | "completed" | "failed";
  triggeredAt: string;
  completedAt: string | null;
  durationMs: number | null;
  result: unknown | null;
  error: string | null;
}

export interface ScheduledJobRecord {
  jobId: string;
  name: string;
  description: string;
  schedule: string;
  timezone: string;
  taskTemplate: {
    title: string;
    description: string;
    category: string;
    priority: string;
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
  runHistory: RunHistoryEntry[];
}

export interface ScheduledJobListOptions {
  enabled?: boolean;
  category?: string;
  nextRunBefore?: string;
  limit?: number;
  offset?: number;
}

export class ScheduledJobStore {
  private records = new Map<string, ScheduledJobRecord>();

  apply(event: ScheduledJobEvent): void {
    if (event instanceof JobRegistered) {
      let computedNextRun: string | null = null;
      if (event.enabled) {
        try {
          computedNextRun = nextRun(event.schedule).toISOString();
        } catch { /* invalid cron, leave null */ }
      }
      this.records.set(event.jobId, {
        jobId: event.jobId,
        name: event.name,
        description: event.description,
        schedule: event.schedule,
        timezone: event.timezone,
        taskTemplate: { ...event.taskTemplate },
        enabled: event.enabled,
        maxConcurrent: event.maxConcurrent,
        catchUp: event.catchUp,
        lastRunAt: null,
        nextRunAt: computedNextRun,
        runCount: 0,
        failCount: 0,
        consecutiveFailures: 0,
        maxConsecutiveFailures: event.maxConsecutiveFailures,
        runHistory: [],
      });
      return;
    }

    const id = event.jobId;
    const record = this.records.get(id);
    if (!record) return;

    if (event instanceof JobTriggered) {
      record.lastRunAt = event.triggeredAt;
      record.runHistory.unshift({
        runId: event.runId,
        status: "running",
        triggeredAt: event.triggeredAt,
        completedAt: null,
        durationMs: null,
        result: null,
        error: null,
      });
      // Keep only last 10 runs
      if (record.runHistory.length > 10) {
        record.runHistory = record.runHistory.slice(0, 10);
      }
      // Recalculate next run
      try {
        record.nextRunAt = nextRun(record.schedule, new Date(event.triggeredAt)).toISOString();
      } catch { /* leave as is */ }
    } else if (event instanceof JobRunCompleted) {
      record.runCount++;
      record.consecutiveFailures = 0;
      const run = record.runHistory.find(r => r.runId === event.runId);
      if (run) {
        run.status = "completed";
        run.completedAt = event.completedAt;
        run.result = event.result;
        if (run.triggeredAt) {
          run.durationMs = new Date(event.completedAt).getTime() - new Date(run.triggeredAt).getTime();
        }
      }
    } else if (event instanceof JobRunFailed) {
      record.runCount++;
      record.failCount++;
      record.consecutiveFailures++;
      const run = record.runHistory.find(r => r.runId === event.runId);
      if (run) {
        run.status = "failed";
        run.completedAt = event.failedAt;
        run.error = event.error;
        if (run.triggeredAt) {
          run.durationMs = new Date(event.failedAt).getTime() - new Date(run.triggeredAt).getTime();
        }
      }
    } else if (event instanceof JobDisabled) {
      record.enabled = false;
      record.nextRunAt = null;
    } else if (event instanceof JobEnabled) {
      record.enabled = true;
      record.consecutiveFailures = 0;
      try {
        record.nextRunAt = nextRun(record.schedule).toISOString();
      } catch { /* leave null */ }
    }
  }

  get(jobId: string): ScheduledJobRecord | undefined {
    const r = this.records.get(jobId);
    return r ? { ...r, taskTemplate: { ...r.taskTemplate }, runHistory: r.runHistory.map(h => ({ ...h })) } : undefined;
  }

  list(options?: ScheduledJobListOptions): ScheduledJobRecord[] {
    let results = [...this.records.values()];
    if (options?.enabled !== undefined) results = results.filter(r => r.enabled === options.enabled);
    if (options?.category) results = results.filter(r => r.taskTemplate.category === options.category);
    if (options?.nextRunBefore) {
      const cutoff = new Date(options.nextRunBefore).getTime();
      results = results.filter(r => r.nextRunAt && new Date(r.nextRunAt).getTime() <= cutoff);
    }
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit).map(r => ({
      ...r,
      taskTemplate: { ...r.taskTemplate },
      runHistory: r.runHistory.map(h => ({ ...h })),
    }));
  }

  getAll(): ScheduledJobRecord[] {
    return this.list();
  }
}
