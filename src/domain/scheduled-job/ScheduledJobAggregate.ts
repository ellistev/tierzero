import { Aggregate } from "../../infra/aggregate";
import { RegisterJob, TriggerJob, CompleteJobRun, FailJobRun, DisableJob, EnableJob } from "./commands";
import { JobRegistered, JobTriggered, JobRunCompleted, JobRunFailed, JobDisabled, JobEnabled } from "./events";

interface ScheduledJobState extends Record<string, unknown> {
  jobId: string;
  name: string;
  schedule: string;
  description: string;
  taskTemplate: {
    title: string;
    description: string;
    category: string;
    priority: string;
    agentType?: string;
  };
  timezone: string;
  enabled: boolean;
  maxConcurrent: number;
  catchUp: boolean;
  maxConsecutiveFailures: number;
  runCount: number;
  failCount: number;
  consecutiveFailures: number;
  activeRuns: number;
  lastRunAt: string | null;
  registeredAt: string;
}

export class ScheduledJobAggregate extends Aggregate<ScheduledJobState> {
  static type = "ScheduledJobAggregate" as const;

  constructor() {
    super();

    this._registerCommandHandler(RegisterJob, (_state, cmd) => {
      return [new JobRegistered(
        cmd.jobId, cmd.name, cmd.schedule, cmd.taskTemplate,
        cmd.description, cmd.timezone, cmd.enabled,
        cmd.maxConcurrent, cmd.catchUp, cmd.maxConsecutiveFailures,
        cmd.registeredAt
      )];
    });

    this._registerCommandHandler(TriggerJob, (state, cmd) => {
      if (!state.jobId) throw new Error("Job does not exist");
      if (!state.enabled) throw new Error("Job is disabled");
      if (state.activeRuns >= state.maxConcurrent) throw new Error("Max concurrent runs reached");
      return [new JobTriggered(cmd.jobId, cmd.triggeredAt, cmd.runId)];
    });

    this._registerCommandHandler(CompleteJobRun, (state, cmd) => {
      if (!state.jobId) throw new Error("Job does not exist");
      return [new JobRunCompleted(cmd.jobId, cmd.runId, cmd.result, cmd.completedAt)];
    });

    this._registerCommandHandler(FailJobRun, (state, cmd) => {
      if (!state.jobId) throw new Error("Job does not exist");
      const events: unknown[] = [new JobRunFailed(cmd.jobId, cmd.runId, cmd.error, cmd.failedAt)];
      // Auto-disable after maxConsecutiveFailures
      if (state.consecutiveFailures + 1 >= state.maxConsecutiveFailures) {
        events.push(new JobDisabled(
          cmd.jobId,
          `Auto-disabled after ${state.consecutiveFailures + 1} consecutive failures`,
          cmd.failedAt
        ));
      }
      return events;
    });

    this._registerCommandHandler(DisableJob, (state, cmd) => {
      if (!state.jobId) throw new Error("Job does not exist");
      if (!state.enabled) throw new Error("Job is already disabled");
      return [new JobDisabled(cmd.jobId, cmd.reason, cmd.disabledAt)];
    });

    this._registerCommandHandler(EnableJob, (state, cmd) => {
      if (!state.jobId) throw new Error("Job does not exist");
      if (state.enabled) throw new Error("Job is already enabled");
      return [new JobEnabled(cmd.jobId, cmd.enabledAt)];
    });

    // Event handlers
    this._registerEventHandler(JobRegistered, (_state, e) => ({
      jobId: e.jobId,
      name: e.name,
      schedule: e.schedule,
      description: e.description,
      taskTemplate: e.taskTemplate,
      timezone: e.timezone,
      enabled: e.enabled,
      maxConcurrent: e.maxConcurrent,
      catchUp: e.catchUp,
      maxConsecutiveFailures: e.maxConsecutiveFailures,
      runCount: 0,
      failCount: 0,
      consecutiveFailures: 0,
      activeRuns: 0,
      lastRunAt: null,
      registeredAt: e.registeredAt,
    }));

    this._registerEventHandler(JobTriggered, (state, e) => ({
      ...state,
      activeRuns: (state.activeRuns as number) + 1,
      lastRunAt: e.triggeredAt,
    }));

    this._registerEventHandler(JobRunCompleted, (state) => ({
      ...state,
      runCount: (state.runCount as number) + 1,
      activeRuns: Math.max(0, (state.activeRuns as number) - 1),
      consecutiveFailures: 0,
    }));

    this._registerEventHandler(JobRunFailed, (state) => ({
      ...state,
      runCount: (state.runCount as number) + 1,
      failCount: (state.failCount as number) + 1,
      consecutiveFailures: (state.consecutiveFailures as number) + 1,
      activeRuns: Math.max(0, (state.activeRuns as number) - 1),
    }));

    this._registerEventHandler(JobDisabled, (state) => ({
      ...state,
      enabled: false,
    }));

    this._registerEventHandler(JobEnabled, (state) => ({
      ...state,
      enabled: true,
      consecutiveFailures: 0,
    }));
  }
}
