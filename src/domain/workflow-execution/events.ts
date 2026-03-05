export class WorkflowExecutionStarted {
  static type = "WorkflowExecutionStarted" as const;
  constructor(
    public readonly executionId: string,
    public readonly ticketId: string,
    public readonly workflowId: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new WorkflowExecutionStarted(d.executionId as string, d.ticketId as string, d.workflowId as string, d.startedAt as string);
  }
}

export class WorkflowStepStarted {
  static type = "WorkflowStepStarted" as const;
  constructor(
    public readonly executionId: string,
    public readonly stepName: string,
    public readonly detail: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new WorkflowStepStarted(d.executionId as string, d.stepName as string, d.detail as string, d.startedAt as string);
  }
}

export class WorkflowStepCompleted {
  static type = "WorkflowStepCompleted" as const;
  constructor(
    public readonly executionId: string,
    public readonly stepName: string,
    public readonly detail: string,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new WorkflowStepCompleted(d.executionId as string, d.stepName as string, d.detail as string, d.completedAt as string);
  }
}

export class WorkflowStepFailed {
  static type = "WorkflowStepFailed" as const;
  constructor(
    public readonly executionId: string,
    public readonly stepName: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new WorkflowStepFailed(d.executionId as string, d.stepName as string, d.error as string, d.failedAt as string);
  }
}

export class WorkflowStepSkipped {
  static type = "WorkflowStepSkipped" as const;
  constructor(
    public readonly executionId: string,
    public readonly stepName: string,
    public readonly reason: string,
    public readonly skippedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new WorkflowStepSkipped(d.executionId as string, d.stepName as string, d.reason as string, d.skippedAt as string);
  }
}

export class WorkflowExecutionCompleted {
  static type = "WorkflowExecutionCompleted" as const;
  constructor(
    public readonly executionId: string,
    public readonly summary: string,
    public readonly data: Record<string, unknown>,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new WorkflowExecutionCompleted(d.executionId as string, d.summary as string, (d.data ?? {}) as Record<string, unknown>, d.completedAt as string);
  }
}

export class WorkflowExecutionFailed {
  static type = "WorkflowExecutionFailed" as const;
  constructor(
    public readonly executionId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new WorkflowExecutionFailed(d.executionId as string, d.error as string, d.failedAt as string);
  }
}

export const workflowExecutionEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [WorkflowExecutionStarted.type]: WorkflowExecutionStarted.fromObject,
  [WorkflowStepStarted.type]: WorkflowStepStarted.fromObject,
  [WorkflowStepCompleted.type]: WorkflowStepCompleted.fromObject,
  [WorkflowStepFailed.type]: WorkflowStepFailed.fromObject,
  [WorkflowStepSkipped.type]: WorkflowStepSkipped.fromObject,
  [WorkflowExecutionCompleted.type]: WorkflowExecutionCompleted.fromObject,
  [WorkflowExecutionFailed.type]: WorkflowExecutionFailed.fromObject,
};
