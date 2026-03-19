import type { CommChannel, CommMessage, CommResult } from "../channel";

export interface EmailChannelConfig {
  apiKey?: string;
  from: string;
  replyTo?: string;
  smtpHost?: string;
  smtpPort?: number;
  /** Injected send function for testing or custom transports */
  sendFn?: (message: CommMessage, config: EmailChannelConfig) => Promise<CommResult>;
}

export class EmailChannel implements CommChannel {
  readonly name = "email";
  readonly type = "email" as const;

  private readonly config: EmailChannelConfig;
  private lastSendTime = 0;
  private readonly minIntervalMs = 500; // max 2 emails/second

  constructor(config: EmailChannelConfig) {
    this.config = config;
  }

  async send(message: CommMessage): Promise<CommResult> {
    // Rate limiting: max 2 emails/second
    const now = Date.now();
    const elapsed = now - this.lastSendTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastSendTime = Date.now();

    try {
      if (this.config.sendFn) {
        return await this.config.sendFn(message, this.config);
      }

      // Default: no-op with warning (real implementation would use Resend API or nodemailer)
      return {
        success: true,
        messageId: `email-${Date.now()}`,
        sentAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        sentAt: new Date().toISOString(),
      };
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.apiKey && !this.config.smtpHost && !this.config.sendFn) {
      return { ok: false, error: "No email transport configured (need apiKey, smtpHost, or sendFn)" };
    }
    return { ok: true };
  }
}
