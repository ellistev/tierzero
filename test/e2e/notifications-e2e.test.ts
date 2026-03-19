/**
 * E2E Test: Notifications integration - wire notifications to task lifecycle events.
 *
 * Tests the full flow:
 *   1. Create orchestrator with mock webhook channel
 *   2. Submit and complete a task -> verify notification sent
 *   3. Submit and fail a task (3 retries) -> verify failure notification
 *   4. Simulate agent hung -> verify critical alert
 *   5. Query GET /api/notifications and verify history
 *   6. Verify notification success rate tracking
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { TaskRouter } from "../../src/orchestrator/task-router";
import { AgentRegistry, type NormalizedTask, type TaskResult, type TaskSource } from "../../src/orchestrator/agent-registry";
import { AgentSupervisor } from "../../src/orchestrator/supervisor";
import { TaskQueueStore } from "../../src/read-models/task-queue";
import { AgentProcessStore } from "../../src/read-models/agent-processes";
import { EventBus } from "../../src/infra/event-bus";
import { NotificationManager } from "../../src/comms/notification-manager";
import { NotificationStore } from "../../src/read-models/notifications";
import { notificationsRouter } from "../../src/infra/rest/notifications-router";
import { taskRouterApi } from "../../src/infra/rest/task-router-api";
import type { CommChannel, CommMessage, CommResult } from "../../src/comms/channel";
import { AgentHung } from "../../src/domain/agent-process/events";

const silentLogger = { log: () => {}, error: () => {} };

/** In-memory notification channel that records sent messages. */
class MockWebhookChannel implements CommChannel {
  name = "webhook";
  type = "webhook" as const;
  sent: CommMessage[] = [];

  async send(msg: CommMessage): Promise<CommResult> {
    this.sent.push(msg);
    return { success: true, messageId: `msg-${this.sent.length}`, sentAt: new Date().toISOString() };
  }
  async healthCheck() { return { ok: true }; }
}

/** Channel that always fails, for testing failure tracking. */
class FailingChannel implements CommChannel {
  name = "failing";
  type = "webhook" as const;
  attempts = 0;

  async send(_msg: CommMessage): Promise<CommResult> {
    this.attempts++;
    return { success: false, error: "Connection refused", sentAt: new Date().toISOString() };
  }
  async healthCheck() { return { ok: false, error: "unreachable" }; }
}

interface TestContext {
  router: TaskRouter;
  taskStore: TaskQueueStore;
  agentStore: AgentProcessStore;
  eventBus: EventBus;
  notifier: NotificationManager;
  notifStore: NotificationStore;
  webhook: MockWebhookChannel;
  app: express.Express;
  server: ReturnType<typeof express.prototype.listen>;
  port: number;
  executedTasks: NormalizedTask[];
  flags: { shouldFail: boolean };
}

async function setupE2E(): Promise<TestContext> {
  const executedTasks: NormalizedTask[] = [];
  const flags = { shouldFail: false };

  const registry = new AgentRegistry();
  registry.register({
    name: "test-agent",
    type: "test",
    capabilities: ["code", "monitoring", "communication", "operations", "research"],
    maxConcurrent: 10,
    available: true,
    execute: async (task: NormalizedTask): Promise<TaskResult> => {
      executedTasks.push(task);
      if (flags.shouldFail) {
        return { success: false, output: { error: "Simulated failure" }, durationMs: 10 };
      }
      return { success: true, output: { message: "done" }, durationMs: 42 };
    },
  });

  const router = new TaskRouter({ registry, maxRetries: 2, logger: silentLogger });
  const taskStore = new TaskQueueStore();
  router.on("event", (event) => taskStore.apply(event));

  const agentStore = new AgentProcessStore();

  const eventBus = new EventBus();
  eventBus.connectRouter(router);

  // NotificationManager with mock webhook
  const notifier = new NotificationManager();
  const webhook = new MockWebhookChannel();
  notifier.registerChannel(webhook);

  // Add notification rules
  notifier.addRule({
    id: "task-completed",
    trigger: "task.completed",
    channels: ["webhook"],
    template: "task-completed",
    enabled: true,
  });
  notifier.addRule({
    id: "task-failed",
    trigger: "task.failed",
    channels: ["webhook"],
    template: "task-failed",
    enabled: true,
  });
  notifier.addRule({
    id: "task-escalated",
    trigger: "task.escalated",
    channels: ["webhook"],
    template: "task-escalated",
    enabled: true,
  });
  notifier.addRule({
    id: "agent-hung",
    trigger: "agent.hung",
    channels: ["webhook"],
    template: "agent-hung",
    enabled: true,
  });
  notifier.addRule({
    id: "pr-created",
    trigger: "pr.created",
    channels: ["webhook"],
    template: "pr-created",
    enabled: true,
  });

  // Subscribe NotificationManager to EventBus events
  eventBus.subscribe("TaskCompleted", (data) => notifier.processEvent("task.completed", data));
  eventBus.subscribe("TaskFailed", (data) => notifier.processEvent("task.failed", data));
  eventBus.subscribe("TaskEscalated", (data) => notifier.processEvent("task.escalated", data));
  eventBus.subscribe("AgentHung", (data) => notifier.processEvent("agent.hung", data));
  eventBus.subscribe("PRCreated", (data) => notifier.processEvent("pr.created", data));

  // Wire notification events to NotificationStore read model
  const notifStore = new NotificationStore();
  notifier.on("event", (event) => notifStore.apply(event));

  // Express app
  const app = express();
  app.use(express.json());
  app.use(taskRouterApi({ store: taskStore, router, registry }));
  app.use(notificationsRouter({ store: notifStore, manager: notifier }));

  const server = app.listen(0);
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    router, taskStore, agentStore, eventBus, notifier, notifStore,
    webhook, app, server, port, executedTasks, flags,
  };
}

async function request(port: number, method: string, path: string, body?: unknown) {
  const resp = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = resp.headers.get("content-type") ?? "";
  const respBody = contentType.includes("json") ? await resp.json() : null;
  return { status: resp.status, body: respBody };
}

describe("Notifications E2E", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupE2E();
  });

  afterEach(() => {
    ctx.server.close();
  });

  it("task completion triggers notification to configured channels", async () => {
    const source: TaskSource = { adapter: "test", externalId: "1", payload: {} };
    await ctx.router.submit(source, "Test task complete", "Do something", "code");

    // Wait for async processing
    await new Promise(r => setTimeout(r, 200));

    assert.ok(ctx.webhook.sent.length >= 1, "Expected at least one notification sent");
    const msg = ctx.webhook.sent.find(m => m.subject?.includes("completed") || m.body.includes("completed"));
    assert.ok(msg, "Expected a task-completed notification");
  });

  it("task failure triggers notification with error details", async () => {
    ctx.flags.shouldFail = true;
    // The router has maxRetries: 2, so after 3 attempts (1 + 2 retries) it escalates
    const source: TaskSource = { adapter: "test", externalId: "2", payload: {} };
    await ctx.router.submit(source, "Failing task", "This will fail", "code");

    // Wait for retries and escalation
    await new Promise(r => setTimeout(r, 500));

    // Should have task-failed or task-escalated notification
    const hasFailureNotif = ctx.webhook.sent.some(m =>
      (m.subject?.includes("failed") || m.body.includes("failed") ||
       m.subject?.includes("escalat") || m.body.includes("escalat"))
    );
    assert.ok(hasFailureNotif, "Expected a failure or escalation notification");
  });

  it("agent hung triggers critical alert to all channels", async () => {
    // Simulate agent hung event through the event bus
    const hungEvent = new AgentHung("proc-1", "task-1", new Date(Date.now() - 30000).toISOString(), new Date().toISOString());
    ctx.eventBus.publish("AgentHung", hungEvent);

    // Wait for async notification processing
    await new Promise(r => setTimeout(r, 200));

    const hasHungNotif = ctx.webhook.sent.some(m =>
      m.subject?.includes("Hung") || m.body.includes("stopped responding")
    );
    assert.ok(hasHungNotif, "Expected an agent-hung notification");
  });

  it("GET /api/notifications shows notification history", async () => {
    // Trigger a task completion
    const source: TaskSource = { adapter: "test", externalId: "3", payload: {} };
    await ctx.router.submit(source, "History test", "Check history", "code");

    await new Promise(r => setTimeout(r, 200));

    const resp = await request(ctx.port, "GET", "/api/notifications");
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body), "Expected array of notifications");
    assert.ok(resp.body.length > 0, "Expected at least one notification record");

    // Each record should have required fields
    const record = resp.body[0];
    assert.ok(record.notificationId, "Expected notificationId");
    assert.ok(record.channelName, "Expected channelName");
    assert.ok(record.status, "Expected status");
    assert.ok(record.timestamp, "Expected timestamp");
  });

  it("GET /api/notifications/channels shows channel health", async () => {
    const resp = await request(ctx.port, "GET", "/api/notifications/channels");
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));
    assert.ok(resp.body.length >= 1, "Expected at least one channel");

    const webhookChannel = resp.body.find((ch: any) => ch.name === "webhook");
    assert.ok(webhookChannel, "Expected webhook channel");
    assert.equal(webhookChannel.ok, true);
  });

  it("GET /api/notifications/rules returns configured rules", async () => {
    const resp = await request(ctx.port, "GET", "/api/notifications/rules");
    assert.equal(resp.status, 200);
    assert.ok(Array.isArray(resp.body));

    const ruleIds = resp.body.map((r: any) => r.id);
    assert.ok(ruleIds.includes("task-completed"), "Expected task-completed rule");
    assert.ok(ruleIds.includes("task-failed"), "Expected task-failed rule");
    assert.ok(ruleIds.includes("agent-hung"), "Expected agent-hung rule");
    assert.ok(ruleIds.includes("pr-created"), "Expected pr-created rule");
  });

  it("notification success rate tracking works", async () => {
    // Send a successful notification
    const source: TaskSource = { adapter: "test", externalId: "4", payload: {} };
    await ctx.router.submit(source, "Rate tracking", "Test rate", "code");
    await new Promise(r => setTimeout(r, 200));

    const successRate = ctx.notifStore.getSuccessRate();
    assert.ok(successRate.total > 0, "Expected total > 0");
    assert.ok(successRate.sent > 0, "Expected sent > 0");
    assert.equal(successRate.rate, successRate.sent / successRate.total);
  });

  it("notification failure is recorded when channel fails", async () => {
    // Register a failing channel and add a rule for it
    const failingChannel = new FailingChannel();
    ctx.notifier.registerChannel(failingChannel);
    ctx.notifier.addRule({
      id: "fail-test",
      trigger: "task.completed",
      channels: ["failing"],
      template: "task-completed",
      enabled: true,
    });

    const source: TaskSource = { adapter: "test", externalId: "5", payload: {} };
    await ctx.router.submit(source, "Fail channel test", "Test failure", "code");
    await new Promise(r => setTimeout(r, 200));

    const failedRate = ctx.notifStore.getSuccessRate("failing");
    assert.ok(failedRate.failed > 0, "Expected failed notifications for failing channel");
  });

  it("PRCreated event triggers pr-created notification", async () => {
    // Publish a PRCreated event to the bus
    const prEvent = {
      constructor: { type: "PRCreated" },
      prNumber: 42,
      prUrl: "https://github.com/test/repo/pull/42",
      title: "Fix bug #10",
      issueNumber: 10,
    };
    ctx.eventBus.publish("PRCreated", prEvent);

    await new Promise(r => setTimeout(r, 200));

    const hasPRNotif = ctx.webhook.sent.some(m =>
      m.subject?.includes("PR") || m.body.includes("pull") ||
      m.body.includes("PR") || m.body.includes("#42")
    );
    assert.ok(hasPRNotif, "Expected a pr-created notification");
  });

  it("full event -> notification -> delivery -> history flow", async () => {
    // 1. Submit and complete a task
    const source1: TaskSource = { adapter: "test", externalId: "flow-1", payload: {} };
    await ctx.router.submit(source1, "Flow test task", "Full flow", "code");
    await new Promise(r => setTimeout(r, 200));

    // 2. Simulate agent hung
    const hungEvent = new AgentHung("proc-flow", "task-flow", new Date(Date.now() - 30000).toISOString(), new Date().toISOString());
    ctx.eventBus.publish("AgentHung", hungEvent);
    await new Promise(r => setTimeout(r, 200));

    // 3. Verify webhook got both notifications
    assert.ok(ctx.webhook.sent.length >= 2, `Expected at least 2 notifications, got ${ctx.webhook.sent.length}`);

    // 4. Verify notification history via API
    const resp = await request(ctx.port, "GET", "/api/notifications");
    assert.equal(resp.status, 200);
    assert.ok(resp.body.length >= 2, `Expected at least 2 history records, got ${resp.body.length}`);

    // 5. Verify success rate
    const rate = ctx.notifStore.getSuccessRate("webhook");
    assert.ok(rate.total >= 2, `Expected total >= 2, got ${rate.total}`);
    assert.equal(rate.rate, 1, "Expected 100% success rate for webhook channel");
  });
});
