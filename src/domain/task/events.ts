export class TaskSubmitted {
  static type = "TaskSubmitted" as const;
  constructor(
    public readonly taskId: string,
    public readonly sourceType: string,
    public readonly sourceId: string,
    public readonly payload: unknown,
    public readonly receivedAt: string,
    public readonly priority: string,
    public readonly metadata: Record<string, unknown> | undefined,
    public readonly title: string,
    public readonly description: string,
    public readonly category: string,
    public readonly createdAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TaskSubmitted(
      d.taskId as string, d.sourceType as string, d.sourceId as string,
      d.payload, d.receivedAt as string, d.priority as string,
      d.metadata as Record<string, unknown> | undefined,
      d.title as string, d.description as string, d.category as string,
      d.createdAt as string
    );
  }
}

export class TaskAssigned {
  static type = "TaskAssigned" as const;
  constructor(
    public readonly taskId: string,
    public readonly agentName: string,
    public readonly assignedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TaskAssigned(d.taskId as string, d.agentName as string, d.assignedAt as string);
  }
}

export class TaskStarted {
  static type = "TaskStarted" as const;
  constructor(
    public readonly taskId: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TaskStarted(d.taskId as string, d.startedAt as string);
  }
}

export class TaskCompleted {
  static type = "TaskCompleted" as const;
  constructor(
    public readonly taskId: string,
    public readonly result: unknown,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TaskCompleted(d.taskId as string, d.result, d.completedAt as string);
  }
}

export class TaskFailed {
  static type = "TaskFailed" as const;
  constructor(
    public readonly taskId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TaskFailed(d.taskId as string, d.error as string, d.failedAt as string);
  }
}

export class TaskEscalated {
  static type = "TaskEscalated" as const;
  constructor(
    public readonly taskId: string,
    public readonly reason: string,
    public readonly escalatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TaskEscalated(d.taskId as string, d.reason as string, d.escalatedAt as string);
  }
}

export class TaskRetried {
  static type = "TaskRetried" as const;
  constructor(
    public readonly taskId: string,
    public readonly retryCount: number,
    public readonly retriedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TaskRetried(d.taskId as string, d.retryCount as number, d.retriedAt as string);
  }
}

export type TaskEvent =
  | TaskSubmitted
  | TaskAssigned
  | TaskStarted
  | TaskCompleted
  | TaskFailed
  | TaskEscalated
  | TaskRetried;

export const taskEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [TaskSubmitted.type]: TaskSubmitted.fromObject,
  [TaskAssigned.type]: TaskAssigned.fromObject,
  [TaskStarted.type]: TaskStarted.fromObject,
  [TaskCompleted.type]: TaskCompleted.fromObject,
  [TaskFailed.type]: TaskFailed.fromObject,
  [TaskEscalated.type]: TaskEscalated.fromObject,
  [TaskRetried.type]: TaskRetried.fromObject,
};
