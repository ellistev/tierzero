import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { CommChannel, CommMessage, CommResult } from "./channel";
import { renderTemplate } from "./templates/index";
import { NotificationSent, NotificationFailed, NotificationRuleTriggered } from "../domain/notification/events";

export interface NotificationRule {
  id: string;
  trigger: 'task.completed' | 'task.failed' | 'task.escalated' | 'agent.hung' | 'health.degraded' | 'custom';
  filter?: {
    category?: string;
    priority?: string;
    agentName?: string;
  };
  channels: string[];
  template: string;
  enabled: boolean;
}

export interface NotificationRecord {
  notificationId: string;
  channelName: string;
  recipient: string;
  subject?: string;
  status: 'sent' | 'failed';
  error?: string;
  ruleId?: string;
  eventType?: string;
  timestamp: string;
}

export class NotificationManager extends EventEmitter {
  private readonly channels = new Map<string, CommChannel>();
  private readonly rules: NotificationRule[] = [];
  private readonly _history: NotificationRecord[] = [];

  registerChannel(channel: CommChannel): void {
    this.channels.set(channel.name, channel);
  }

  addRule(rule: NotificationRule): void {
    this.rules.push(rule);
  }

  getRules(): NotificationRule[] {
    return [...this.rules];
  }

  getChannels(): CommChannel[] {
    return [...this.channels.values()];
  }

  async processEvent(eventType: string, eventData: unknown): Promise<void> {
    const matchingRules = this.rules.filter(r =>
      r.enabled && r.trigger === eventType && this.matchesFilter(r.filter, eventData)
    );

    for (const rule of matchingRules) {
      const now = new Date().toISOString();
      this.emit("event", new NotificationRuleTriggered(rule.id, eventType, rule.channels.length, now));

      const rendered = renderTemplate(rule.template, eventData);
      if (!rendered) continue;

      for (const channelName of rule.channels) {
        await this.send(channelName, rendered, rule.id, eventType);
      }
    }
  }

  async send(channelName: string, message: CommMessage, ruleId?: string, eventType?: string): Promise<CommResult> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      const result: CommResult = {
        success: false,
        error: `Channel "${channelName}" not found`,
        sentAt: new Date().toISOString(),
      };
      return result;
    }

    const notificationId = randomUUID();
    const recipient = Array.isArray(message.to) ? message.to.join(", ") : message.to;

    let result = await channel.send(message);

    // Retry once on failure
    if (!result.success) {
      result = await channel.send(message);
    }

    if (result.success) {
      const event = new NotificationSent(notificationId, channelName, recipient, message.subject, result.sentAt);
      this.emit("event", event);
      this._history.push({
        notificationId,
        channelName,
        recipient,
        subject: message.subject,
        status: "sent",
        ruleId,
        eventType,
        timestamp: result.sentAt,
      });
    } else {
      const event = new NotificationFailed(notificationId, channelName, result.error ?? "Unknown error", result.sentAt);
      this.emit("event", event);
      this._history.push({
        notificationId,
        channelName,
        recipient,
        subject: message.subject,
        status: "failed",
        error: result.error,
        ruleId,
        eventType,
        timestamp: result.sentAt,
      });
    }

    return result;
  }

  history(options?: { limit?: number; channelName?: string }): NotificationRecord[] {
    let results = [...this._history];
    if (options?.channelName) {
      results = results.filter(r => r.channelName === options.channelName);
    }
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }
    return results;
  }

  private matchesFilter(filter: NotificationRule['filter'], eventData: unknown): boolean {
    if (!filter) return true;
    const data = eventData as Record<string, unknown>;

    if (filter.category && data.category !== filter.category) return false;
    if (filter.priority && data.priority !== filter.priority) return false;
    if (filter.agentName && data.agentName !== filter.agentName) return false;

    return true;
  }
}
