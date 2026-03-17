export class StartPipeline {
  static type = "StartPipeline" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly issueNumber: number,
    public readonly title: string,
    public readonly branch: string,
    public readonly startedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new StartPipeline(d.pipelineId as string, d.issueNumber as number, d.title as string, d.branch as string, d.startedAt as string);
  }
}

export class CompleteAgentWork {
  static type = "CompleteAgentWork" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly summary: string,
    public readonly filesChanged: string[],
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new CompleteAgentWork(d.pipelineId as string, d.summary as string, (d.filesChanged ?? []) as string[], d.completedAt as string);
  }
}

export class RecordTestRun {
  static type = "RecordTestRun" as const;
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
    return new RecordTestRun(d.pipelineId as string, d.passed as boolean, d.total as number, d.passing as number, d.failing as number, d.attempt as number, d.ranAt as string);
  }
}

export class RecordTestFix {
  static type = "RecordTestFix" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly attempt: number,
    public readonly summary: string,
    public readonly filesChanged: string[],
    public readonly fixedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordTestFix(d.pipelineId as string, d.attempt as number, d.summary as string, (d.filesChanged ?? []) as string[], d.fixedAt as string);
  }
}

export class CreatePR {
  static type = "CreatePR" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly prNumber: number,
    public readonly prUrl: string,
    public readonly draft: boolean,
    public readonly createdAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new CreatePR(d.pipelineId as string, d.prNumber as number, d.prUrl as string, d.draft as boolean, d.createdAt as string);
  }
}

export class CompletePipeline {
  static type = "CompletePipeline" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly status: "success" | "partial",
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new CompletePipeline(d.pipelineId as string, d.status as "success" | "partial", d.completedAt as string);
  }
}

export class FailPipeline {
  static type = "FailPipeline" as const;
  constructor(
    public readonly pipelineId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new FailPipeline(d.pipelineId as string, d.error as string, d.failedAt as string);
  }
}
