export class NotificationSent {
  static type = "NotificationSent" as const;
  constructor(
    public readonly notificationId: string,
    public readonly channelName: string,
    public readonly recipient: string,
    public readonly subject: string | undefined,
    public readonly sentAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new NotificationSent(
      d.notificationId as string, d.channelName as string,
      d.recipient as string, d.subject as string | undefined,
      d.sentAt as string
    );
  }
}

export class NotificationFailed {
  static type = "NotificationFailed" as const;
  constructor(
    public readonly notificationId: string,
    public readonly channelName: string,
    public readonly error: string,
    public readonly failedAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new NotificationFailed(
      d.notificationId as string, d.channelName as string,
      d.error as string, d.failedAt as string
    );
  }
}

export class NotificationRuleTriggered {
  static type = "NotificationRuleTriggered" as const;
  constructor(
    public readonly ruleId: string,
    public readonly eventType: string,
    public readonly channelCount: number,
    public readonly triggeredAt: string
  ) {}
  static fromObject(d: Record<string, unknown>) {
    return new NotificationRuleTriggered(
      d.ruleId as string, d.eventType as string,
      d.channelCount as number, d.triggeredAt as string
    );
  }
}

export type NotificationEvent = NotificationSent | NotificationFailed | NotificationRuleTriggered;

export const notificationEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
  [NotificationSent.type]: NotificationSent.fromObject,
  [NotificationFailed.type]: NotificationFailed.fromObject,
  [NotificationRuleTriggered.type]: NotificationRuleTriggered.fromObject,
};
