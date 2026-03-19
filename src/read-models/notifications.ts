import {
  NotificationSent,
  NotificationFailed,
  NotificationRuleTriggered,
  type NotificationEvent,
} from "../domain/notification/events";

export interface NotificationRecord {
  notificationId: string;
  channelName: string;
  recipient: string;
  subject?: string;
  status: 'sent' | 'failed';
  error?: string;
  timestamp: string;
}

export interface RuleTriggeredRecord {
  ruleId: string;
  eventType: string;
  channelCount: number;
  triggeredAt: string;
}

export interface NotificationListOptions {
  channelName?: string;
  status?: 'sent' | 'failed';
  limit?: number;
  offset?: number;
}

export class NotificationStore {
  private records = new Map<string, NotificationRecord>();
  private ruleRecords: RuleTriggeredRecord[] = [];

  apply(event: NotificationEvent): void {
    if (event instanceof NotificationSent) {
      this.records.set(event.notificationId, {
        notificationId: event.notificationId,
        channelName: event.channelName,
        recipient: event.recipient,
        subject: event.subject,
        status: 'sent',
        timestamp: event.sentAt,
      });
    } else if (event instanceof NotificationFailed) {
      this.records.set(event.notificationId, {
        notificationId: event.notificationId,
        channelName: event.channelName,
        status: 'failed',
        error: event.error,
        recipient: '',
        timestamp: event.failedAt,
      });
    } else if (event instanceof NotificationRuleTriggered) {
      this.ruleRecords.push({
        ruleId: event.ruleId,
        eventType: event.eventType,
        channelCount: event.channelCount,
        triggeredAt: event.triggeredAt,
      });
    }
  }

  get(notificationId: string): NotificationRecord | undefined {
    const r = this.records.get(notificationId);
    return r ? { ...r } : undefined;
  }

  list(options?: NotificationListOptions): NotificationRecord[] {
    let results = [...this.records.values()];

    if (options?.channelName) {
      results = results.filter(r => r.channelName === options.channelName);
    }
    if (options?.status) {
      results = results.filter(r => r.status === options.status);
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit).map(r => ({ ...r }));
  }

  getAll(): NotificationRecord[] {
    return this.list();
  }

  getSuccessRate(channelName?: string): { total: number; sent: number; failed: number; rate: number } {
    let records = [...this.records.values()];
    if (channelName) {
      records = records.filter(r => r.channelName === channelName);
    }
    const total = records.length;
    const sent = records.filter(r => r.status === 'sent').length;
    const failed = records.filter(r => r.status === 'failed').length;
    return { total, sent, failed, rate: total > 0 ? sent / total : 0 };
  }

  getRuleHistory(): RuleTriggeredRecord[] {
    return [...this.ruleRecords];
  }
}
