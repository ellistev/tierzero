/**
 * Mock email channel that captures sent emails in memory.
 * Implements CommChannel interface.
 */

import type { CommChannel, CommMessage, CommResult } from "../../../src/comms/channel";

export interface CapturedEmail {
  to: string | string[];
  subject?: string;
  body: string;
  priority?: string;
  sentAt: string;
}

export class MockEmailChannel implements CommChannel {
  readonly name: string;
  readonly type = "email" as const;
  readonly sent: CapturedEmail[] = [];
  private healthy = true;

  constructor(name = "mock-email") {
    this.name = name;
  }

  async send(message: CommMessage): Promise<CommResult> {
    if (!this.healthy) {
      return { success: false, error: "Email service unavailable", sentAt: new Date().toISOString() };
    }

    const email: CapturedEmail = {
      to: message.to,
      subject: message.subject,
      body: message.body,
      priority: message.priority,
      sentAt: new Date().toISOString(),
    };
    this.sent.push(email);

    return { success: true, messageId: `email-${this.sent.length}`, sentAt: email.sentAt };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    return { ok: this.healthy };
  }

  /** Simulate email service going down */
  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  /** Get emails matching a subject pattern */
  findBySubject(pattern: string): CapturedEmail[] {
    return this.sent.filter((e) => e.subject?.includes(pattern));
  }

  clear(): void {
    this.sent.length = 0;
  }
}
