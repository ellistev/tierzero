export class DeployInitiated {
  static type = "DeployInitiated" as const;
  constructor(
    public readonly deployId: string,
    public readonly environment: string,
    public readonly version: string,
    public readonly strategy: string,
    public readonly initiatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new DeployInitiated(d.deployId as string, d.environment as string, d.version as string, d.strategy as string, d.initiatedAt as string);
  }
}

export class DeploySucceeded {
  static type = "DeploySucceeded" as const;
  constructor(
    public readonly deployId: string,
    public readonly healthCheckPassed: boolean,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new DeploySucceeded(d.deployId as string, d.healthCheckPassed as boolean, d.completedAt as string);
  }
}

export class DeployFailed {
  static type = "DeployFailed" as const;
  constructor(
    public readonly deployId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new DeployFailed(d.deployId as string, d.error as string, d.failedAt as string);
  }
}

export class RollbackInitiated {
  static type = "RollbackInitiated" as const;
  constructor(
    public readonly deployId: string,
    public readonly reason: string,
    public readonly initiatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RollbackInitiated(d.deployId as string, d.reason as string, d.initiatedAt as string);
  }
}

export class RollbackCompleted {
  static type = "RollbackCompleted" as const;
  constructor(
    public readonly deployId: string,
    public readonly restoredVersion: string,
    public readonly completedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RollbackCompleted(d.deployId as string, d.restoredVersion as string, d.completedAt as string);
  }
}

export const deploymentEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [DeployInitiated.type]: DeployInitiated.fromObject,
  [DeploySucceeded.type]: DeploySucceeded.fromObject,
  [DeployFailed.type]: DeployFailed.fromObject,
  [RollbackInitiated.type]: RollbackInitiated.fromObject,
  [RollbackCompleted.type]: RollbackCompleted.fromObject,
};
