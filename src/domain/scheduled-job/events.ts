export class JobRegistered {
  static type = "JobRegistered" as const;
  constructor(
    public readonly jobId: string,
    public readonly name: string,
    public readonly schedule: string,
    public readonly taskTemplate: {
      title: string;
      description: string;
      category: string;
      priority: string;
      agentType?: string;
    },
    public readonly description: string,
    public readonly timezone: string,
    public readonly enabled: boolean,
    public readonly maxConcurrent: number,
    public readonly catchUp: boolean,
    public readonly maxConsecutiveFailures: number,
    public readonly registeredAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    const t = d.taskTemplate as Record<string, unknown>;
    return new JobRegistered(
      d.jobId as string, d.name as string, d.schedule as string,
      { title: t.title as string, description: t.description as string, category: t.category as string, priority: t.priority as string, agentType: t.agentType as string | undefined },
      d.description as string, d.timezone as string, d.enabled as boolean,
      d.maxConcurrent as number, d.catchUp as boolean,
      d.maxConsecutiveFailures as number, d.registeredAt as string
    );
  }
}

export class JobTriggered {
  static type = "JobTriggered" as const;
  constructor(
    public readonly jobId: string,
    public readonly triggeredAt: string,
    public readonly runId: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new JobTriggered(d.jobId as string, d.triggeredAt as string, d.runId as string);
  }
}

export class JobRunCompleted {
  static type = "JobRunCompleted" as const;
  constructor(
    public readonly jobId: string,
    public readonly runId: string,
    public readonly result: unknown,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new JobRunCompleted(d.jobId as string, d.runId as string, d.result, d.completedAt as string);
  }
}

export class JobRunFailed {
  static type = "JobRunFailed" as const;
  constructor(
    public readonly jobId: string,
    public readonly runId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new JobRunFailed(d.jobId as string, d.runId as string, d.error as string, d.failedAt as string);
  }
}

export class JobDisabled {
  static type = "JobDisabled" as const;
  constructor(
    public readonly jobId: string,
    public readonly reason: string,
    public readonly disabledAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new JobDisabled(d.jobId as string, d.reason as string, d.disabledAt as string);
  }
}

export class JobEnabled {
  static type = "JobEnabled" as const;
  constructor(
    public readonly jobId: string,
    public readonly enabledAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new JobEnabled(d.jobId as string, d.enabledAt as string);
  }
}

export type ScheduledJobEvent =
  | JobRegistered
  | JobTriggered
  | JobRunCompleted
  | JobRunFailed
  | JobDisabled
  | JobEnabled;

export const scheduledJobEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [JobRegistered.type]: JobRegistered.fromObject,
  [JobTriggered.type]: JobTriggered.fromObject,
  [JobRunCompleted.type]: JobRunCompleted.fromObject,
  [JobRunFailed.type]: JobRunFailed.fromObject,
  [JobDisabled.type]: JobDisabled.fromObject,
  [JobEnabled.type]: JobEnabled.fromObject,
};
