export class SubmitTask {
  static type = "SubmitTask" as const;
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
    return new SubmitTask(
      d.taskId as string, d.sourceType as string, d.sourceId as string,
      d.payload, d.receivedAt as string, d.priority as string,
      d.metadata as Record<string, unknown> | undefined,
      d.title as string, d.description as string, d.category as string,
      d.createdAt as string
    );
  }
}

export class AssignTask {
  static type = "AssignTask" as const;
  constructor(
    public readonly taskId: string,
    public readonly agentName: string,
    public readonly assignedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AssignTask(d.taskId as string, d.agentName as string, d.assignedAt as string);
  }
}

export class StartTask {
  static type = "StartTask" as const;
  constructor(
    public readonly taskId: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new StartTask(d.taskId as string, d.startedAt as string);
  }
}

export class CompleteTask {
  static type = "CompleteTask" as const;
  constructor(
    public readonly taskId: string,
    public readonly result: unknown,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new CompleteTask(d.taskId as string, d.result, d.completedAt as string);
  }
}

export class FailTask {
  static type = "FailTask" as const;
  constructor(
    public readonly taskId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new FailTask(d.taskId as string, d.error as string, d.failedAt as string);
  }
}

export class EscalateTask {
  static type = "EscalateTask" as const;
  constructor(
    public readonly taskId: string,
    public readonly reason: string,
    public readonly escalatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new EscalateTask(d.taskId as string, d.reason as string, d.escalatedAt as string);
  }
}

export class RetryTask {
  static type = "RetryTask" as const;
  constructor(
    public readonly taskId: string,
    public readonly retryCount: number,
    public readonly retriedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RetryTask(d.taskId as string, d.retryCount as number, d.retriedAt as string);
  }
}
