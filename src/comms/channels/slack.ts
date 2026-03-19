import type { CommChannel, CommMessage, CommResult } from "../channel";

export interface SlackChannelConfig {
  token: string;
  defaultChannel?: string;
  /** Injected send function for testing */
  sendFn?: (message: CommMessage, config: SlackChannelConfig) => Promise<CommResult>;
}

export class SlackChannel implements CommChannel {
  readonly name = "slack";
  readonly type = "slack" as const;

  private readonly config: SlackChannelConfig;

  constructor(config: SlackChannelConfig) {
    this.config = config;
  }

  async send(message: CommMessage): Promise<CommResult> {
    const channel = (Array.isArray(message.to) ? message.to[0] : message.to) || this.config.defaultChannel;
    if (!channel) {
      return {
        success: false,
        error: "No channel specified and no defaultChannel configured",
        sentAt: new Date().toISOString(),
      };
    }

    try {
      if (this.config.sendFn) {
        return await this.config.sendFn(message, this.config);
      }

      // Default: no-op (real implementation would use @slack/web-api chat.postMessage)
      return {
        success: true,
        messageId: `slack-${Date.now()}`,
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
    if (!this.config.token) {
      return { ok: false, error: "No Slack token configured" };
    }
    return { ok: true };
  }
}
