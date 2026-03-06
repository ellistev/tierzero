export class AttemptIntent {
  static type = "AttemptIntent" as const;
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
    return new AttemptIntent(d.intentId as string, d.intentName as string, d.goal as string, d.page as string, (d.value as string) ?? null, (d.context ?? {}) as Record<string, unknown>, d.attemptedAt as string);
  }
}

export class ResolveSelector {
  static type = "ResolveSelector" as const;
  constructor(
    public readonly intentId: string,
    public readonly selector: string,
    public readonly method: string,
    public readonly durationMs: number,
    public readonly resolvedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new ResolveSelector(d.intentId as string, d.selector as string, d.method as string, d.durationMs as number, d.resolvedAt as string);
  }
}

export class SucceedIntent {
  static type = "SucceedIntent" as const;
  constructor(
    public readonly intentId: string,
    public readonly selector: string,
    public readonly method: string,
    public readonly durationMs: number,
    public readonly succeededAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new SucceedIntent(d.intentId as string, d.selector as string, d.method as string, d.durationMs as number, d.succeededAt as string);
  }
}

export class FailIntent {
  static type = "FailIntent" as const;
  constructor(
    public readonly intentId: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new FailIntent(d.intentId as string, d.error as string, d.failedAt as string);
  }
}

export class AttemptRecovery {
  static type = "AttemptRecovery" as const;
  constructor(
    public readonly intentId: string,
    public readonly reason: string,
    public readonly strategy: string,
    public readonly attemptNumber: number,
    public readonly attemptedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AttemptRecovery(d.intentId as string, d.reason as string, d.strategy as string, d.attemptNumber as number, d.attemptedAt as string);
  }
}

export class SucceedRecovery {
  static type = "SucceedRecovery" as const;
  constructor(
    public readonly intentId: string,
    public readonly strategy: string,
    public readonly detail: string,
    public readonly succeededAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new SucceedRecovery(d.intentId as string, d.strategy as string, d.detail as string, d.succeededAt as string);
  }
}

export class FailRecovery {
  static type = "FailRecovery" as const;
  constructor(
    public readonly intentId: string,
    public readonly strategy: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new FailRecovery(d.intentId as string, d.strategy as string, d.error as string, d.failedAt as string);
  }
}

export class EscalateIntent {
  static type = "EscalateIntent" as const;
  constructor(
    public readonly intentId: string,
    public readonly reason: string,
    public readonly escalatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new EscalateIntent(d.intentId as string, d.reason as string, d.escalatedAt as string);
  }
}
