/**
 * E2E Test: Scheduler integration with orchestrator.
 *
 * Tests the full flow:
 *   Scheduler cron fires -> onTrigger -> TaskRouter.submit() -> agent executes
 *   ScheduledJobStore tracks run history
 *   REST API exposes scheduler state
 *   Force-run via REST API
 *   Auto-disable after consecutive failures
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { Scheduler } from "../../src/scheduler/scheduler";
import { builtInJobs } from "../../src/scheduler/jobs/index";
import { TaskRouter } from "../../src/orchestrator/task-router";
import { AgentRegistry, type NormalizedTask, type TaskResult, type TaskSource } from "../../src/orchestrator/agent-registry";
import { TaskQueueStore } from "../../src/read-models/task-queue";
import { ScheduledJobStore } from "../../src/read-models/scheduled-jobs";
import { schedulerRouter } from "../../src/infra/rest/scheduler-router";
import { taskRouterApi } from "../../src/infra/rest/task-router-api";
import { EventBus } from "../../src/infra/event-bus";
import type { TaskEvent } from "../../src/domain/task/events";

const silentLogger = { log: () => {}, error: () => {} };

interface TestContext {
  scheduler: Scheduler;
  router: TaskRouter;
  taskStore: TaskQueueStore;
  schedulerStore: ScheduledJobStore;
  eventBus: EventBus;
  registry: AgentRegistry;
  app: express.Express;
  server: ReturnType<typeof express.prototype.listen>;
  port: number;
  executedTasks: NormalizedTask[];
}

async function setupE2E(): Promise<TestContext> {
  const executedTasks: NormalizedTask[] = [];

  const registry = new AgentRegistry();
  registry.register({
    name: "e2e-agent",
    type: "test",
    capabilities: ["code", "monitoring", "communication", "operations", "research"],
    maxConcurrent: 10,
    available: true,
    execute: async (task: NormalizedTask): Promise<TaskResult> => {
      executedTasks.push(task);
      return { success: true, output: { message: "done" }, durationMs: 10 };
    },
  });

  const router = new TaskRouter({ registry, logger: silentLogger });
  const taskStore = new TaskQueueStore();
  router.on("event", (event: TaskEvent) => taskStore.apply(event));

  const scheduler = new Scheduler();
  const schedulerStore = new ScheduledJobStore();
  scheduler.on("event", (event) => schedulerStore.apply(event));

  const eventBus = new EventBus();
  eventBus.connectScheduler(scheduler);

  // Wire scheduler to router
  scheduler.onTrigger = async (job) => {
    const source: TaskSource = {
      type: "schedule",
      id: `schedule-${job.id}-${Date.now()}`,
      payload: job,
      receivedAt: new Date().toISOString(),
      priority: job.taskTemplate.priority,
    };
    router.submit(source, job.taskTemplate.title, job.taskTemplate.description ?? "", job.taskTemplate.category ?? "monitoring");
  };

  // Set up Express app
  const app = express();
  app.use(express.json());
  app.use(schedulerRouter({ store: schedulerStore, scheduler }));
  app.use(taskRouterApi({ store: taskStore, router, registry }));

  const server = app.listen(0);
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return { scheduler, router, taskStore, schedulerStore, eventBus, registry, app, server, port, executedTasks };
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

describe("Scheduler E2E", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupE2E();
  });

  afterEach(() => {
    ctx.scheduler.stop();
    ctx.eventBus.disconnectScheduler();
    ctx.server.close();
  });

  it("should register built-in jobs and expose via REST API", async () => {
    for (const job of builtInJobs) {
      ctx.scheduler.addJob(job);
    }

    const { status, body } = await request(ctx.port, "GET", "/api/scheduler/jobs");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length >= 5, `Expected at least 5 jobs, got ${body.length}`);

    const ids = body.map((j: any) => j.jobId);
    assert.ok(ids.includes("system-health"));
    assert.ok(ids.includes("connector-health"));
    assert.ok(ids.includes("daily-report"));
    assert.ok(ids.includes("knowledge-maintenance"));
    assert.ok(ids.includes("test-suite"));
  });

  it("should fire job, submit task to router, and track in store", async () => {
    ctx.scheduler.addJob({
      id: "e2e-cron",
      name: "E2E Cron Job",
      description: "E2E test job",
      schedule: "* * * * *",
      taskTemplate: {
        title: "E2E Cron Task",
        description: "Triggered by E2E test",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    // Force-run the job
    await ctx.scheduler.runNow("e2e-cron");
    await new Promise((r) => setTimeout(r, 100));

    // Verify task was executed
    assert.equal(ctx.executedTasks.length, 1);
    assert.equal(ctx.executedTasks[0].title, "E2E Cron Task");
    assert.equal(ctx.executedTasks[0].source.type, "schedule");

    // Record success
    ctx.scheduler.recordSuccess("e2e-cron");

    // Verify ScheduledJobStore shows runCount
    const record = ctx.schedulerStore.get("e2e-cron");
    assert.ok(record);
    assert.equal(record!.runCount, 1);
    assert.ok(record!.lastRunAt);
  });

  it("GET /api/scheduler/jobs should show jobs with lastRunAt after execution", async () => {
    ctx.scheduler.addJob({
      id: "api-test",
      name: "API Test Job",
      description: "",
      schedule: "*/5 * * * *",
      taskTemplate: {
        title: "API Test",
        description: "",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    // Run the job
    await ctx.scheduler.runNow("api-test");
    await new Promise((r) => setTimeout(r, 50));
    ctx.scheduler.recordSuccess("api-test");

    // Check REST API
    const { status, body } = await request(ctx.port, "GET", "/api/scheduler/jobs/api-test");
    assert.equal(status, 200);
    assert.equal(body.jobId, "api-test");
    assert.ok(body.lastRunAt);
    assert.equal(body.runCount, 1);
  });

  it("POST /api/scheduler/jobs/:id/run should force-run and trigger task", async () => {
    ctx.scheduler.addJob({
      id: "force-run-test",
      name: "Force Run Test",
      description: "",
      schedule: "0 0 1 1 *", // very infrequent
      taskTemplate: {
        title: "Force Run Task",
        description: "Triggered via REST API",
        category: "operations",
        priority: "high",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    const { status, body } = await request(ctx.port, "POST", "/api/scheduler/jobs/force-run-test/run");
    assert.equal(status, 200);
    assert.equal(body.message, "Job triggered");

    await new Promise((r) => setTimeout(r, 100));

    // Verify task was submitted to router and executed
    assert.equal(ctx.executedTasks.length, 1);
    assert.equal(ctx.executedTasks[0].title, "Force Run Task");
    assert.equal(ctx.executedTasks[0].category, "operations");
  });

  it("should auto-disable after 5 consecutive failures", async () => {
    ctx.scheduler.addJob({
      id: "auto-disable-test",
      name: "Auto Disable Test",
      description: "",
      schedule: "* * * * *",
      taskTemplate: {
        title: "Fragile Task",
        description: "",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    // Simulate 5 consecutive failures
    for (let i = 0; i < 5; i++) {
      await ctx.scheduler.runNow("auto-disable-test");
      ctx.scheduler.recordFailure("auto-disable-test", `failure ${i + 1}`);
    }

    // Job should be auto-disabled
    const job = ctx.scheduler.getJob("auto-disable-test");
    assert.ok(job);
    assert.equal(job!.enabled, false);
    assert.equal(job!.nextRunAt, null);

    // Store should reflect disabled state
    const record = ctx.schedulerStore.get("auto-disable-test");
    assert.ok(record);
    assert.equal(record!.enabled, false);
    assert.equal(record!.failCount, 5);
    assert.equal(record!.consecutiveFailures, 5);
  });

  it("should register custom jobs via REST API", async () => {
    const { status, body } = await request(ctx.port, "POST", "/api/scheduler/jobs", {
      id: "dynamic-job",
      name: "Dynamic Job",
      schedule: "*/10 * * * *",
      taskTemplate: {
        title: "Dynamic Task",
        description: "Created via API",
        category: "operations",
        priority: "low",
      },
    });

    assert.equal(status, 201);
    assert.equal(body.id, "dynamic-job");
    assert.equal(body.name, "Dynamic Job");
    assert.ok(body.nextRunAt);

    // Verify it's in the scheduler
    const job = ctx.scheduler.getJob("dynamic-job");
    assert.ok(job);
    assert.equal(job!.enabled, true);
  });

  it("GET /api/scheduler/upcoming should return sorted upcoming triggers", async () => {
    for (const job of builtInJobs) {
      ctx.scheduler.addJob(job);
    }

    const { status, body } = await request(ctx.port, "GET", "/api/scheduler/upcoming");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);

    // Verify sorted by nextRunAt
    for (let i = 1; i < body.length; i++) {
      const prev = new Date(body[i - 1].nextRunAt).getTime();
      const curr = new Date(body[i].nextRunAt).getTime();
      assert.ok(prev <= curr, "Upcoming triggers should be sorted by time");
    }
  });

  it("EventBus should receive scheduler events", async () => {
    const receivedEvents: unknown[] = [];
    ctx.eventBus.on("scheduler:event", (event) => receivedEvents.push(event));

    ctx.scheduler.addJob({
      id: "bus-e2e",
      name: "Bus E2E",
      description: "",
      schedule: "*/5 * * * *",
      taskTemplate: {
        title: "Bus E2E",
        description: "",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    // JobRegistered event should have been forwarded
    assert.ok(receivedEvents.length > 0, "EventBus should receive events from scheduler");
  });

  it("should handle enable/disable via REST API", async () => {
    ctx.scheduler.addJob({
      id: "toggle-test",
      name: "Toggle Test",
      description: "",
      schedule: "*/5 * * * *",
      taskTemplate: {
        title: "Toggle",
        description: "",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    // Disable
    let res = await request(ctx.port, "PUT", "/api/scheduler/jobs/toggle-test", { enabled: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);

    // Enable
    res = await request(ctx.port, "PUT", "/api/scheduler/jobs/toggle-test", { enabled: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, true);
  });
});
