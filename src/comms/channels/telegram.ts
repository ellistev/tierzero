import type { CommChannel, CommMessage, CommResult } from "../channel";

export interface TelegramChannelConfig {
  botToken: string;
  defaultChatId?: string;
  /** Injected send function for testing */
  sendFn?: (message: CommMessage, config: TelegramChannelConfig) => Promise<CommResult>;
}

export class TelegramChannel implements CommChannel {
  readonly name = "telegram";
  readonly type = "telegram" as const;

  private readonly config: TelegramChannelConfig;

  constructor(config: TelegramChannelConfig) {
    this.config = config;
  }

  async send(message: CommMessage): Promise<CommResult> {
    const chatId = (Array.isArray(message.to) ? message.to[0] : message.to) || this.config.defaultChatId;
    if (!chatId) {
      return {
        success: false,
        error: "No chat ID specified and no defaultChatId configured",
        sentAt: new Date().toISOString(),
      };
    }

    try {
      if (this.config.sendFn) {
        return await this.config.sendFn(message, this.config);
      }

      // Default: no-op (real implementation would use Telegram Bot API sendMessage)
      return {
        success: true,
        messageId: `telegram-${Date.now()}`,
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
    if (!this.config.botToken) {
      return { ok: false, error: "No Telegram bot token configured" };
    }
    return { ok: true };
  }
}
