import type { InputAdapter, ScheduledTask } from "./types";
import type { TaskSource } from "../agent-registry";

/**
 * Cron-style scheduler using setInterval to avoid adding node-cron dependency.
 * Parses simple cron expressions: "* /N * * * *" means every N minutes.
 */
export class ScheduleAdapter implements InputAdapter {
  readonly name = "schedule";
  onTask: (source: TaskSource) => void = () => {};

  private readonly schedules: ScheduledTask[];
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(schedules: ScheduledTask[]) {
    this.schedules = schedules;
  }

  async start(): Promise<void> {
    for (const schedule of this.schedules) {
      if (!schedule.enabled) continue;

      const intervalMs = parseCronToMs(schedule.cron);
      const timer = setInterval(() => {
        const source: TaskSource = {
          type: "schedule",
          id: `schedule-${schedule.id}-${Date.now()}`,
          payload: { scheduleId: schedule.id, template: schedule.taskTemplate },
          receivedAt: new Date().toISOString(),
          priority: (schedule.taskTemplate.priority as TaskSource['priority']) ?? "low",
          metadata: { scheduleId: schedule.id, cron: schedule.cron },
        };
        this.onTask(source);
      }, intervalMs);

      this.timers.push(timer);
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }
}

/**
 * Parse a cron expression into a millisecond interval.
 * Supports: "* /N * * * *" (every N minutes), full 5-field cron.
 * Falls back to 60000ms (1 minute) for complex expressions.
 */
export function parseCronToMs(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return 60_000;

  const minute = parts[0];

  // "*/N" in the minute field = every N minutes
  if (minute.startsWith("*/")) {
    const n = parseInt(minute.slice(2), 10);
    if (!isNaN(n) && n > 0) return n * 60_000;
  }

  // Single number in minute field, stars elsewhere = every hour at minute N
  if (/^\d+$/.test(minute) && parts[1] === "*") {
    return 60 * 60_000;
  }

  // Default: every minute
  return 60_000;
}
