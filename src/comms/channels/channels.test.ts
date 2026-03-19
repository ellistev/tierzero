import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmailChannel } from "./email";
import { SlackChannel } from "./slack";
import { DiscordChannel } from "./discord";
import { WebhookChannel } from "./webhook";
import { TelegramChannel } from "./telegram";
import type { CommMessage } from "../channel";

const testMessage: CommMessage = {
  to: "test@example.com",
  subject: "Test Subject",
  body: "Test body",
  priority: "normal",
};

describe("EmailChannel", () => {
  it("should send via sendFn", async () => {
    let captured: CommMessage | null = null;
    const ch = new EmailChannel({
      from: "noreply@tierzero.dev",
      apiKey: "test-key",
      sendFn: async (msg) => {
        captured = msg;
        return { success: true, messageId: "em-1", sentAt: "2026-03-18T10:00:00Z" };
      },
    });

    const result = await ch.send(testMessage);
    assert.equal(result.success, true);
    assert.equal(result.messageId, "em-1");
    assert.ok(captured);
    assert.equal(captured!.subject, "Test Subject");
  });

  it("should handle send errors", async () => {
    const ch = new EmailChannel({
      from: "noreply@tierzero.dev",
      apiKey: "test-key",
      sendFn: async () => { throw new Error("SMTP down"); },
    });

    const result = await ch.send(testMessage);
    assert.equal(result.success, false);
    assert.equal(result.error, "SMTP down");
  });

  it("should report unhealthy without transport config", async () => {
    const ch = new EmailChannel({ from: "noreply@tierzero.dev" });
    const health = await ch.healthCheck();
    assert.equal(health.ok, false);
    assert.ok(health.error);
  });

  it("should report healthy with apiKey", async () => {
    const ch = new EmailChannel({ from: "noreply@tierzero.dev", apiKey: "key" });
    const health = await ch.healthCheck();
    assert.equal(health.ok, true);
  });
});

describe("SlackChannel", () => {
  it("should send via sendFn", async () => {
    let captured: CommMessage | null = null;
    const ch = new SlackChannel({
      token: "xoxb-test",
      sendFn: async (msg) => {
        captured = msg;
        return { success: true, messageId: "sl-1", sentAt: "2026-03-18T10:00:00Z" };
      },
    });

    const result = await ch.send({ ...testMessage, to: "#general" });
    assert.equal(result.success, true);
    assert.ok(captured);
  });

  it("should fail without channel or default", async () => {
    const ch = new SlackChannel({ token: "xoxb-test" });
    const result = await ch.send({ ...testMessage, to: "" });
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("No channel specified"));
  });

  it("should handle send errors", async () => {
    const ch = new SlackChannel({
      token: "xoxb-test",
      sendFn: async () => { throw new Error("Slack API error"); },
    });

    const result = await ch.send({ ...testMessage, to: "#general" });
    assert.equal(result.success, false);
    assert.equal(result.error, "Slack API error");
  });

  it("should report healthy with token", async () => {
    const ch = new SlackChannel({ token: "xoxb-test" });
    const health = await ch.healthCheck();
    assert.equal(health.ok, true);
  });

  it("should report unhealthy without token", async () => {
    const ch = new SlackChannel({ token: "" });
    const health = await ch.healthCheck();
    assert.equal(health.ok, false);
  });
});

describe("DiscordChannel", () => {
  it("should send via sendFn", async () => {
    const ch = new DiscordChannel({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      sendFn: async () => ({ success: true, messageId: "dc-1", sentAt: "2026-03-18T10:00:00Z" }),
    });

    const result = await ch.send(testMessage);
    assert.equal(result.success, true);
  });

  it("should handle send errors", async () => {
    const ch = new DiscordChannel({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      sendFn: async () => { throw new Error("Discord down"); },
    });

    const result = await ch.send(testMessage);
    assert.equal(result.success, false);
    assert.equal(result.error, "Discord down");
  });

  it("should report unhealthy without webhook URL", async () => {
    const ch = new DiscordChannel({ webhookUrl: "" });
    const health = await ch.healthCheck();
    assert.equal(health.ok, false);
  });
});

describe("WebhookChannel", () => {
  it("should send via sendFn", async () => {
    let captured: CommMessage | null = null;
    const ch = new WebhookChannel({
      url: "https://hooks.example.com/notify",
      sendFn: async (msg) => {
        captured = msg;
        return { success: true, messageId: "wh-1", sentAt: "2026-03-18T10:00:00Z" };
      },
    });

    const result = await ch.send(testMessage);
    assert.equal(result.success, true);
    assert.ok(captured);
  });

  it("should handle send errors", async () => {
    const ch = new WebhookChannel({
      url: "https://hooks.example.com/notify",
      sendFn: async () => { throw new Error("Connection refused"); },
    });

    const result = await ch.send(testMessage);
    assert.equal(result.success, false);
    assert.equal(result.error, "Connection refused");
  });

  it("should report unhealthy without URL", async () => {
    const ch = new WebhookChannel({ url: "" });
    const health = await ch.healthCheck();
    assert.equal(health.ok, false);
  });
});

describe("TelegramChannel", () => {
  it("should send via sendFn", async () => {
    const ch = new TelegramChannel({
      botToken: "123:ABC",
      sendFn: async () => ({ success: true, messageId: "tg-1", sentAt: "2026-03-18T10:00:00Z" }),
    });

    const result = await ch.send({ ...testMessage, to: "12345" });
    assert.equal(result.success, true);
  });

  it("should fail without chatId or default", async () => {
    const ch = new TelegramChannel({ botToken: "123:ABC" });
    const result = await ch.send({ ...testMessage, to: "" });
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("No chat ID"));
  });

  it("should handle send errors", async () => {
    const ch = new TelegramChannel({
      botToken: "123:ABC",
      sendFn: async () => { throw new Error("Telegram API error"); },
    });

    const result = await ch.send({ ...testMessage, to: "12345" });
    assert.equal(result.success, false);
    assert.equal(result.error, "Telegram API error");
  });

  it("should report unhealthy without bot token", async () => {
    const ch = new TelegramChannel({ botToken: "" });
    const health = await ch.healthCheck();
    assert.equal(health.ok, false);
  });

  it("should report healthy with bot token", async () => {
    const ch = new TelegramChannel({ botToken: "123:ABC" });
    const health = await ch.healthCheck();
    assert.equal(health.ok, true);
  });
});
