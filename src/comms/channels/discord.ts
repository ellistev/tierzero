import type { CommChannel, CommMessage, CommResult } from "../channel";

export interface DiscordChannelConfig {
  webhookUrl: string;
  /** Injected send function for testing */
  sendFn?: (message: CommMessage, config: DiscordChannelConfig) => Promise<CommResult>;
}

export class DiscordChannel implements CommChannel {
  readonly name = "discord";
  readonly type = "discord" as const;

  private readonly config: DiscordChannelConfig;

  constructor(config: DiscordChannelConfig) {
    this.config = config;
  }

  async send(message: CommMessage): Promise<CommResult> {
    try {
      if (this.config.sendFn) {
        return await this.config.sendFn(message, this.config);
      }

      // Default: no-op (real implementation would POST to Discord webhook with embeds)
      return {
        success: true,
        messageId: `discord-${Date.now()}`,
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
    if (!this.config.webhookUrl) {
      return { ok: false, error: "No Discord webhook URL configured" };
    }
    return { ok: true };
  }
}
