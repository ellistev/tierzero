export class StartWorkflowExecution {
  static type = "StartWorkflowExecution" as const;
  constructor(
    public readonly executionId: string,
    public readonly ticketId: string,
    public readonly workflowId: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new StartWorkflowExecution(d.executionId as string, d.ticketId as string, d.workflowId as string, d.startedAt as string);
  }
}

export class StartStep {
  static type = "StartStep" as const;
  constructor(
    public readonly executionId: string,
    public readonly stepName: string,
    public readonly detail: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new StartStep(d.executionId as string, d.stepName as string, d.detail as string, d.startedAt as string);
  }
}

export class CompleteStep {
  static type = "CompleteStep" as const;
  constructor(
    public readonly executionId: string,
    public readonly stepName: string,
    public readonly detail: string,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new CompleteStep(d.executionId as string, d.stepName as string, d.detail as string, d.completedAt as string);
  }
}

export class FailStep {
  static type = "FailStep" as const;
  constructor(
    public readonly executionId: string,
    public readonly stepName: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new FailStep(d.executionId as string, d.stepName as string, d.error as string, d.failedAt as string);
  }
}

export class SkipStep {
  static type = "SkipStep" as const;
  constructor(
    public readonly executionId: string,
    public readonly stepName: string,
    public readonly reason: string,
    public readonly skippedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new SkipStep(d.executionId as string, d.stepName as string, d.reason as string, d.skippedAt as string);
  }
}

export class CompleteExecution {
  static type = "CompleteExecution" as const;
  constructor(
    public readonly executionId: string,
    public readonly summary: string,
    public readonly data: Record<string, unknown>,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new CompleteExecution(d.executionId as string, d.summary as string, (d.data ?? {}) as Record<string, unknown>, d.completedAt as string);
  }
}

export class FailExecution {
  static type = "FailExecution" as const;
  constructor(
    public readonly executionId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new FailExecution(d.executionId as string, d.error as string, d.failedAt as string);
  }
}
