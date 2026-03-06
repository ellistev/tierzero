export class IntentAttempted {
  static type = "IntentAttempted" as const;
  constructor(
    public readonly intentId: string,
    public readonly intentName: string,
    public readonly goal: string,
    public readonly page: string,
    public readonly value: string | null,
    public readonly context: Record<string, unknown>,
    public readonly attemptedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new IntentAttempted(d.intentId as string, d.intentName as string, d.goal as string, d.page as string, (d.value as string) ?? null, (d.context ?? {}) as Record<string, unknown>, d.attemptedAt as string);
  }
}

export class SelectorResolved {
  static type = "SelectorResolved" as const;
  constructor(
    public readonly intentId: string,
    public readonly selector: string,
    public readonly method: string,
    public readonly durationMs: number,
    public readonly resolvedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new SelectorResolved(d.intentId as string, d.selector as string, d.method as string, d.durationMs as number, d.resolvedAt as string);
  }
}

export class IntentSucceeded {
  static type = "IntentSucceeded" as const;
  constructor(
    public readonly intentId: string,
    public readonly selector: string,
    public readonly method: string,
    public readonly durationMs: number,
    public readonly succeededAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new IntentSucceeded(d.intentId as string, d.selector as string, d.method as string, d.durationMs as number, d.succeededAt as string);
  }
}

export class IntentFailed {
  static type = "IntentFailed" as const;
  constructor(
    public readonly intentId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new IntentFailed(d.intentId as string, d.error as string, d.failedAt as string);
  }
}

export class RecoveryAttempted {
  static type = "RecoveryAttempted" as const;
  constructor(
    public readonly intentId: string,
    public readonly reason: string,
    public readonly strategy: string,
    public readonly attemptNumber: number,
    public readonly attemptedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecoveryAttempted(d.intentId as string, d.reason as string, d.strategy as string, d.attemptNumber as number, d.attemptedAt as string);
  }
}

export class RecoverySucceeded {
  static type = "RecoverySucceeded" as const;
  constructor(
    public readonly intentId: string,
    public readonly strategy: string,
    public readonly detail: string,
    public readonly succeededAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecoverySucceeded(d.intentId as string, d.strategy as string, d.detail as string, d.succeededAt as string);
  }
}

export class RecoveryFailed {
  static type = "RecoveryFailed" as const;
  constructor(
    public readonly intentId: string,
    public readonly strategy: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new RecoveryFailed(d.intentId as string, d.strategy as string, d.error as string, d.failedAt as string);
  }
}

export class IntentEscalated {
  static type = "IntentEscalated" as const;
  constructor(
    public readonly intentId: string,
    public readonly reason: string,
    public readonly escalatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new IntentEscalated(d.intentId as string, d.reason as string, d.escalatedAt as string);
  }
}

export const intentExecutionEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [IntentAttempted.type]: IntentAttempted.fromObject,
  [SelectorResolved.type]: SelectorResolved.fromObject,
  [IntentSucceeded.type]: IntentSucceeded.fromObject,
  [IntentFailed.type]: IntentFailed.fromObject,
  [RecoveryAttempted.type]: RecoveryAttempted.fromObject,
  [RecoverySucceeded.type]: RecoverySucceeded.fromObject,
  [RecoveryFailed.type]: RecoveryFailed.fromObject,
  [IntentEscalated.type]: IntentEscalated.fromObject,
};
