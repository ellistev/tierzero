/**
 * Mock Slack channel that captures messages in memory.
 * Implements CommChannel interface.
 */

import type { CommChannel, CommMessage, CommResult } from "../../../src/comms/channel";

export interface CapturedSlackMessage {
  to: string | string[];
  subject?: string;
  body: string;
  priority?: string;
  sentAt: string;
}

export class MockSlackChannel implements CommChannel {
  readonly name: string;
  readonly type = "slack" as const;
  readonly sent: CapturedSlackMessage[] = [];

  constructor(name = "mock-slack") {
    this.name = name;
  }

  async send(message: CommMessage): Promise<CommResult> {
    const msg: CapturedSlackMessage = {
      to: message.to,
      subject: message.subject,
      body: message.body,
      priority: message.priority,
      sentAt: new Date().toISOString(),
    };
    this.sent.push(msg);
    return { success: true, messageId: `slack-${this.sent.length}`, sentAt: msg.sentAt };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  /** Get messages containing a substring in body or subject */
  findByContent(pattern: string): CapturedSlackMessage[] {
    return this.sent.filter(
      (m) => m.body.includes(pattern) || m.subject?.includes(pattern),
    );
  }

  clear(): void {
    this.sent.length = 0;
  }
}
