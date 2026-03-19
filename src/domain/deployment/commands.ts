export class InitiateDeploy {
  static type = "InitiateDeploy" as const;
  constructor(
    public readonly deployId: string,
    public readonly environment: string,
    public readonly version: string,
    public readonly strategy: string,
    public readonly initiatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new InitiateDeploy(d.deployId as string, d.environment as string, d.version as string, d.strategy as string, d.initiatedAt as string);
  }
}

export class RecordDeploySuccess {
  static type = "RecordDeploySuccess" as const;
  constructor(
    public readonly deployId: string,
    public readonly healthCheckPassed: boolean,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordDeploySuccess(d.deployId as string, d.healthCheckPassed as boolean, d.completedAt as string);
  }
}

export class RecordDeployFailure {
  static type = "RecordDeployFailure" as const;
  constructor(
    public readonly deployId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordDeployFailure(d.deployId as string, d.error as string, d.failedAt as string);
  }
}

export class InitiateRollback {
  static type = "InitiateRollback" as const;
  constructor(
    public readonly deployId: string,
    public readonly reason: string,
    public readonly initiatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new InitiateRollback(d.deployId as string, d.reason as string, d.initiatedAt as string);
  }
}

export class RecordRollbackComplete {
  static type = "RecordRollbackComplete" as const;
  constructor(
    public readonly deployId: string,
    public readonly restoredVersion: string,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecordRollbackComplete(d.deployId as string, d.restoredVersion as string, d.completedAt as string);
  }
}
