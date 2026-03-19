import type { CommChannel, CommMessage, CommResult } from "../channel";

export interface WebhookChannelConfig {
  url: string;
  headers?: Record<string, string>;
  method?: string;
  /** Injected send function for testing */
  sendFn?: (message: CommMessage, config: WebhookChannelConfig) => Promise<CommResult>;
}

export class WebhookChannel implements CommChannel {
  readonly name = "webhook";
  readonly type = "webhook" as const;

  private readonly config: WebhookChannelConfig;

  constructor(config: WebhookChannelConfig) {
    this.config = config;
  }

  async send(message: CommMessage): Promise<CommResult> {
    try {
      if (this.config.sendFn) {
        return await this.config.sendFn(message, this.config);
      }

      // Default: POST to configured URL
      const resp = await fetch(this.config.url, {
        method: this.config.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify({
          to: message.to,
          subject: message.subject,
          body: message.body,
          priority: message.priority,
          threadId: message.threadId,
          metadata: message.metadata,
        }),
      });

      if (!resp.ok) {
        return {
          success: false,
          error: `HTTP ${resp.status}: ${resp.statusText}`,
          sentAt: new Date().toISOString(),
        };
      }

      return {
        success: true,
        messageId: `webhook-${Date.now()}`,
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
    if (!this.config.url) {
      return { ok: false, error: "No webhook URL configured" };
    }
    return { ok: true };
  }
}
