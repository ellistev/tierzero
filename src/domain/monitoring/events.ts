export class AlertTriggered {
  static type = "AlertTriggered" as const;
  constructor(
    public readonly alertId: string,
    public readonly ruleId: string,
    public readonly severity: "critical" | "warning" | "info",
    public readonly title: string,
    public readonly triggeredAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AlertTriggered(
      d.alertId as string, d.ruleId as string,
      d.severity as "critical" | "warning" | "info",
      d.title as string, d.triggeredAt as string
    );
  }
}

export class AlertAcknowledged {
  static type = "AlertAcknowledged" as const;
  constructor(
    public readonly alertId: string,
    public readonly acknowledgedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AlertAcknowledged(d.alertId as string, d.acknowledgedAt as string);
  }
}

export class AlertResolved {
  static type = "AlertResolved" as const;
  constructor(
    public readonly alertId: string,
    public readonly resolvedAt: string,
    public readonly autoResolved: boolean
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new AlertResolved(d.alertId as string, d.resolvedAt as string, d.autoResolved as boolean);
  }
}

export class EscalationTriggered {
  static type = "EscalationTriggered" as const;
  constructor(
    public readonly alertId: string,
    public readonly channels: string[],
    public readonly escalatedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new EscalationTriggered(
      d.alertId as string, d.channels as string[], d.escalatedAt as string
    );
  }
}

export class HealthCheckCompleted {
  static type = "HealthCheckCompleted" as const;
  constructor(
    public readonly overall: "healthy" | "degraded" | "critical" | "unknown",
    public readonly componentCount: number,
    public readonly timestamp: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new HealthCheckCompleted(
      d.overall as "healthy" | "degraded" | "critical" | "unknown",
      d.componentCount as number, d.timestamp as string
    );
  }
}

export type MonitoringEvent =
  | AlertTriggered
  | AlertAcknowledged
  | AlertResolved
  | EscalationTriggered
  | HealthCheckCompleted;

export const monitoringEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [AlertTriggered.type]: AlertTriggered.fromObject,
  [AlertAcknowledged.type]: AlertAcknowledged.fromObject,
  [AlertResolved.type]: AlertResolved.fromObject,
  [EscalationTriggered.type]: EscalationTriggered.fromObject,
  [HealthCheckCompleted.type]: HealthCheckCompleted.fromObject,
};
