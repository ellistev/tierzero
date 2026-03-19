import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { notificationsRouter } from "./notifications-router";
import { NotificationStore } from "../../read-models/notifications";
import { NotificationManager } from "../../comms/notification-manager";
import { EmailChannel } from "../../comms/channels/email";
import { SlackChannel } from "../../comms/channels/slack";
import { NotificationSent, NotificationFailed } from "../../domain/notification/events";

function setup() {
  const store = new NotificationStore();
  const manager = new NotificationManager();

  const emailChannel = new EmailChannel({
    from: "test@test.com",
    apiKey: "key",
    sendFn: async () => ({ success: true, messageId: "em-1", sentAt: "2026-03-18T10:00:00Z" }),
  });
  const slackChannel = new SlackChannel({
    token: "xoxb-test",
    defaultChannel: "#general",
    sendFn: async () => ({ success: true, messageId: "sl-1", sentAt: "2026-03-18T10:00:00Z" }),
  });

  manager.registerChannel(emailChannel);
  manager.registerChannel(slackChannel);

  // Wire events to store
  manager.on("event", (e) => store.apply(e));

  const app = express();
  app.use(express.json());
  app.use(notificationsRouter({ store, manager }));

  return { app, store, manager };
}

async function request(app: express.Express, method: string, path: string, body?: unknown) {
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(`http://localhost:${port}${path}`, opts);
    const json = await resp.json();
    return { status: resp.status, body: json };
  } finally {
    server.close();
  }
}

describe("Notifications REST API", () => {
  it("GET /api/notifications should return empty list initially", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "GET", "/api/notifications");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  it("GET /api/notifications should return stored notifications", async () => {
    const { app, store } = setup();
    store.apply(new NotificationSent("n1", "email", "user@test.com", "Subject", "2026-03-18T10:00:00Z"));

    const { status, body } = await request(app, "GET", "/api/notifications");
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].notificationId, "n1");
  });

  it("GET /api/notifications should filter by channel", async () => {
    const { app, store } = setup();
    store.apply(new NotificationSent("n1", "email", "a@test.com", "S1", "2026-03-18T10:00:00Z"));
    store.apply(new NotificationSent("n2", "slack", "#gen", "S2", "2026-03-18T10:01:00Z"));

    const { body } = await request(app, "GET", "/api/notifications?channel=email");
    assert.equal(body.length, 1);
    assert.equal(body[0].channelName, "email");
  });

  it("GET /api/notifications should filter by status", async () => {
    const { app, store } = setup();
    store.apply(new NotificationSent("n1", "email", "a@test.com", "S1", "2026-03-18T10:00:00Z"));
    store.apply(new NotificationFailed("n2", "slack", "error", "2026-03-18T10:01:00Z"));

    const { body } = await request(app, "GET", "/api/notifications?status=failed");
    assert.equal(body.length, 1);
    assert.equal(body[0].status, "failed");
  });

  it("GET /api/notifications/rules should return empty list initially", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "GET", "/api/notifications/rules");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  it("POST /api/notifications/rules should create a rule", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "POST", "/api/notifications/rules", {
      id: "r1",
      trigger: "task.completed",
      channels: ["email"],
      template: "task-completed",
      enabled: true,
    });
    assert.equal(status, 201);
    assert.equal(body.id, "r1");
    assert.equal(body.trigger, "task.completed");
  });

  it("POST /api/notifications/rules should validate required fields", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "POST", "/api/notifications/rules", {
      id: "r1",
    });
    assert.equal(status, 400);
    assert.ok(body.message);
  });

  it("POST /api/notifications/send should send a notification", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "POST", "/api/notifications/send", {
      channel: "email",
      message: { to: "user@test.com", subject: "Test", body: "Hello" },
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
  });

  it("POST /api/notifications/send should validate required fields", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "POST", "/api/notifications/send", {});
    assert.equal(status, 400);
    assert.ok(body.message);
  });

  it("GET /api/notifications/channels should list channels with health", async () => {
    const { app } = setup();
    const { status, body } = await request(app, "GET", "/api/notifications/channels");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 2);

    const emailCh = body.find((c: { name: string }) => c.name === "email");
    assert.ok(emailCh);
    assert.equal(emailCh.ok, true);
    assert.equal(emailCh.type, "email");
  });
});
