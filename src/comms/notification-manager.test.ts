import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NotificationManager } from "./notification-manager";
import { EmailChannel } from "./channels/email";
import { SlackChannel } from "./channels/slack";
import { WebhookChannel } from "./channels/webhook";
import { NotificationSent, NotificationFailed, NotificationRuleTriggered } from "../domain/notification/events";
import type { CommMessage, CommResult } from "./channel";

function makeSuccessChannel(name: string, type: "email" | "slack" | "webhook") {
  if (type === "email") {
    return new EmailChannel({
      from: "test@test.com",
      apiKey: "key",
      sendFn: async () => ({ success: true, messageId: `${name}-1`, sentAt: "2026-03-18T10:00:00Z" }),
    });
  }
  if (type === "slack") {
    return new SlackChannel({
      token: "xoxb-test",
      defaultChannel: "#general",
      sendFn: async () => ({ success: true, messageId: `${name}-1`, sentAt: "2026-03-18T10:00:00Z" }),
    });
  }
  return new WebhookChannel({
    url: "https://hooks.example.com",
    sendFn: async () => ({ success: true, messageId: `${name}-1`, sentAt: "2026-03-18T10:00:00Z" }),
  });
}

describe("NotificationManager", () => {
  it("should register channels", () => {
    const mgr = new NotificationManager();
    mgr.registerChannel(makeSuccessChannel("email", "email"));
    mgr.registerChannel(makeSuccessChannel("slack", "slack"));
    assert.equal(mgr.getChannels().length, 2);
  });

  it("should add and retrieve rules", () => {
    const mgr = new NotificationManager();
    mgr.addRule({
      id: "r1",
      trigger: "task.completed",
      channels: ["email"],
      template: "task-completed",
      enabled: true,
    });
    assert.equal(mgr.getRules().length, 1);
    assert.equal(mgr.getRules()[0].id, "r1");
  });

  it("should send a one-off notification", async () => {
    const mgr = new NotificationManager();
    mgr.registerChannel(makeSuccessChannel("email", "email"));

    const result = await mgr.send("email", {
      to: "user@test.com",
      subject: "Hello",
      body: "Test body",
    });
    assert.equal(result.success, true);
  });

  it("should return error for unknown channel", async () => {
    const mgr = new NotificationManager();
    const result = await mgr.send("nonexistent", { to: "x", body: "test" });
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("not found"));
  });

  it("should emit NotificationSent event on success", async () => {
    const mgr = new NotificationManager();
    mgr.registerChannel(makeSuccessChannel("email", "email"));

    const events: unknown[] = [];
    mgr.on("event", (e) => events.push(e));

    await mgr.send("email", { to: "user@test.com", body: "test" });

    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof NotificationSent);
  });

  it("should emit NotificationFailed event on failure", async () => {
    const mgr = new NotificationManager();
    const failChannel = new EmailChannel({
      from: "test@test.com",
      apiKey: "key",
      sendFn: async () => ({ success: false, error: "SMTP error", sentAt: "2026-03-18T10:00:00Z" }),
    });
    mgr.registerChannel(failChannel);

    const events: unknown[] = [];
    mgr.on("event", (e) => events.push(e));

    await mgr.send("email", { to: "user@test.com", body: "test" });

    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof NotificationFailed);
  });

  it("should retry once on failure", async () => {
    let callCount = 0;
    const mgr = new NotificationManager();
    const ch = new EmailChannel({
      from: "test@test.com",
      apiKey: "key",
      sendFn: async () => {
        callCount++;
        return { success: false, error: "fail", sentAt: "2026-03-18T10:00:00Z" };
      },
    });
    mgr.registerChannel(ch);

    await mgr.send("email", { to: "user@test.com", body: "test" });
    assert.equal(callCount, 2); // original + 1 retry
  });

  it("should succeed on retry", async () => {
    let callCount = 0;
    const mgr = new NotificationManager();
    const ch = new EmailChannel({
      from: "test@test.com",
      apiKey: "key",
      sendFn: async () => {
        callCount++;
        if (callCount === 1) return { success: false, error: "transient", sentAt: "2026-03-18T10:00:00Z" };
        return { success: true, messageId: "em-retry", sentAt: "2026-03-18T10:00:01Z" };
      },
    });
    mgr.registerChannel(ch);

    const events: unknown[] = [];
    mgr.on("event", (e) => events.push(e));

    const result = await mgr.send("email", { to: "user@test.com", body: "test" });
    assert.equal(result.success, true);
    assert.equal(events.length, 1);
    assert.ok(events[0] instanceof NotificationSent);
  });

  it("should record history", async () => {
    const mgr = new NotificationManager();
    mgr.registerChannel(makeSuccessChannel("email", "email"));
    mgr.registerChannel(makeSuccessChannel("slack", "slack"));

    await mgr.send("email", { to: "user@test.com", body: "test" });
    await mgr.send("slack", { to: "#general", body: "test" });

    assert.equal(mgr.history().length, 2);
    assert.equal(mgr.history({ channelName: "email" }).length, 1);
    assert.equal(mgr.history({ limit: 1 }).length, 1);
  });

  it("should process events and match rules", async () => {
    const mgr = new NotificationManager();
    const sentMessages: CommMessage[] = [];

    const ch = new EmailChannel({
      from: "test@test.com",
      apiKey: "key",
      sendFn: async (msg) => {
        sentMessages.push(msg);
        return { success: true, messageId: "em-rule", sentAt: "2026-03-18T10:00:00Z" };
      },
    });
    mgr.registerChannel(ch);

    mgr.addRule({
      id: "r1",
      trigger: "task.completed",
      channels: ["email"],
      template: "task-completed",
      enabled: true,
    });

    const events: unknown[] = [];
    mgr.on("event", (e) => events.push(e));

    await mgr.processEvent("task.completed", {
      title: "Fix bug",
      taskId: "t-1",
      result: "done",
      durationMs: 3000,
    });

    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].subject?.includes("Task Completed"));

    // Should have both RuleTriggered and NotificationSent events
    const ruleEvents = events.filter(e => e instanceof NotificationRuleTriggered);
    const sentEvents = events.filter(e => e instanceof NotificationSent);
    assert.equal(ruleEvents.length, 1);
    assert.equal(sentEvents.length, 1);
  });

  it("should not fire disabled rules", async () => {
    const mgr = new NotificationManager();
    mgr.registerChannel(makeSuccessChannel("email", "email"));

    mgr.addRule({
      id: "r1",
      trigger: "task.completed",
      channels: ["email"],
      template: "task-completed",
      enabled: false,
    });

    const events: unknown[] = [];
    mgr.on("event", (e) => events.push(e));

    await mgr.processEvent("task.completed", { title: "X", taskId: "t-1", result: "ok", durationMs: 1000 });

    assert.equal(events.length, 0);
  });

  it("should filter events by category", async () => {
    const mgr = new NotificationManager();
    mgr.registerChannel(makeSuccessChannel("email", "email"));

    mgr.addRule({
      id: "r1",
      trigger: "task.completed",
      filter: { category: "code" },
      channels: ["email"],
      template: "task-completed",
      enabled: true,
    });

    const events: unknown[] = [];
    mgr.on("event", (e) => events.push(e));

    // Should not match - wrong category
    await mgr.processEvent("task.completed", { title: "X", taskId: "t-1", result: "ok", durationMs: 1000, category: "ops" });
    assert.equal(events.length, 0);

    // Should match
    await mgr.processEvent("task.completed", { title: "X", taskId: "t-2", result: "ok", durationMs: 1000, category: "code" });
    assert.ok(events.length > 0);
  });

  it("should send to multiple channels from one rule", async () => {
    const mgr = new NotificationManager();
    mgr.registerChannel(makeSuccessChannel("email", "email"));
    mgr.registerChannel(makeSuccessChannel("slack", "slack"));

    mgr.addRule({
      id: "r1",
      trigger: "task.escalated",
      channels: ["email", "slack"],
      template: "task-escalated",
      enabled: true,
    });

    await mgr.processEvent("task.escalated", { title: "Deploy", taskId: "t-1", reason: "Max retries" });

    assert.equal(mgr.history().length, 2);
  });
});
