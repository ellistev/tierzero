export class PipelineStarted {
  static type = "PipelineStarted" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly issueNumber: number,
    public readonly title: string,
    public readonly branch: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new PipelineStarted(d.pipelineId as string, d.issueNumber as number, d.title as string, d.branch as string, d.startedAt as string);
  }
}

export class AgentWorkCompleted {
  static type = "AgentWorkCompleted" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly summary: string,
    public readonly filesChanged: string[],
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AgentWorkCompleted(d.pipelineId as string, d.summary as string, (d.filesChanged ?? []) as string[], d.completedAt as string);
  }
}

export class TestsRan {
  static type = "TestsRan" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly passed: boolean,
    public readonly total: number,
    public readonly passing: number,
    public readonly failing: number,
    public readonly attempt: number,
    public readonly ranAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TestsRan(d.pipelineId as string, d.passed as boolean, d.total as number, d.passing as number, d.failing as number, d.attempt as number, d.ranAt as string);
  }
}

export class TestFixApplied {
  static type = "TestFixApplied" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly attempt: number,
    public readonly summary: string,
    public readonly filesChanged: string[],
    public readonly fixedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new TestFixApplied(d.pipelineId as string, d.attempt as number, d.summary as string, (d.filesChanged ?? []) as string[], d.fixedAt as string);
  }
}

export class PRCreated {
  static type = "PRCreated" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly prNumber: number,
    public readonly prUrl: string,
    public readonly draft: boolean,
    public readonly createdAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new PRCreated(d.pipelineId as string, d.prNumber as number, d.prUrl as string, d.draft as boolean, d.createdAt as string);
  }
}

export class PipelineCompleted {
  static type = "PipelineCompleted" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly status: "success" | "partial",
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new PipelineCompleted(d.pipelineId as string, d.status as "success" | "partial", d.completedAt as string);
  }
}

export class PipelineFailed {
  static type = "PipelineFailed" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new PipelineFailed(d.pipelineId as string, d.error as string, d.failedAt as string);
  }
}

export const issuePipelineEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [PipelineStarted.type]: PipelineStarted.fromObject,
  [AgentWorkCompleted.type]: AgentWorkCompleted.fromObject,
  [TestsRan.type]: TestsRan.fromObject,
  [TestFixApplied.type]: TestFixApplied.fromObject,
  [PRCreated.type]: PRCreated.fromObject,
  [PipelineCompleted.type]: PipelineCompleted.fromObject,
  [PipelineFailed.type]: PipelineFailed.fromObject,
};
