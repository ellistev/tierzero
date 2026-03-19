/**
 * Integration Test: Scheduler -> TaskRouter -> Agent flow.
 *
 * Verifies that when the Scheduler triggers a job, it submits a task
 * to the TaskRouter, which routes it to an agent for execution.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { Scheduler } from "./scheduler";
import { builtInJobs } from "./jobs/index";
import { TaskRouter } from "../orchestrator/task-router";
import { AgentRegistry, type NormalizedTask, type TaskResult, type TaskSource } from "../orchestrator/agent-registry";
import { TaskQueueStore } from "../read-models/task-queue";
import { ScheduledJobStore } from "../read-models/scheduled-jobs";
import { EventBus } from "../infra/event-bus";
import type { TaskEvent } from "../domain/task/events";

const silentLogger = { log: () => {}, error: () => {} };

function makeTestRegistry(executedTasks: NormalizedTask[]): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register({
    name: "test-agent",
    type: "test",
    capabilities: ["code", "monitoring", "communication", "operations", "research"],
    maxConcurrent: 10,
    available: true,
    execute: async (task: NormalizedTask): Promise<TaskResult> => {
      executedTasks.push(task);
      return { success: true, output: { message: "done" }, durationMs: 10 };
    },
  });
  return registry;
}

describe("Scheduler Integration: scheduler -> router -> agent", () => {
  const schedulers: Scheduler[] = [];

  afterEach(() => {
    for (const s of schedulers) s.stop();
    schedulers.length = 0;
  });

  it("should submit a task to the router when a job triggers", async () => {
    const executedTasks: NormalizedTask[] = [];
    const registry = makeTestRegistry(executedTasks);
    const router = new TaskRouter({ registry, logger: silentLogger });
    const store = new TaskQueueStore();
    router.on("event", (event: TaskEvent) => store.apply(event));

    const scheduler = new Scheduler();
    schedulers.push(scheduler);

    scheduler.addJob({
      id: "test-trigger",
      name: "Test Trigger",
      description: "Triggers immediately via runNow",
      schedule: "0 0 1 1 *",
      taskTemplate: {
        title: "Scheduled Health Check",
        description: "Run health check",
        category: "monitoring",
        priority: "high",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    // Wire scheduler to router (same as cli.ts does)
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

    // Force-run the job
    await scheduler.runNow("test-trigger");
    await new Promise((r) => setTimeout(r, 100));

    // Verify task was submitted and executed
    assert.equal(executedTasks.length, 1);
    assert.equal(executedTasks[0].title, "Scheduled Health Check");
    assert.equal(executedTasks[0].category, "monitoring");
    assert.equal(executedTasks[0].source.type, "schedule");

    // Verify store recorded the task
    const all = store.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].status, "completed");
  });

  it("should emit domain events to ScheduledJobStore", async () => {
    const scheduler = new Scheduler();
    schedulers.push(scheduler);
    const schedulerStore = new ScheduledJobStore();
    scheduler.on("event", (event) => schedulerStore.apply(event));

    scheduler.addJob({
      id: "event-test",
      name: "Event Test",
      description: "Tests event emission",
      schedule: "*/5 * * * *",
      taskTemplate: {
        title: "Event Check",
        description: "",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    // Verify JobRegistered event was applied
    const record = schedulerStore.get("event-test");
    assert.ok(record, "Job should be in store after addJob");
    assert.equal(record!.name, "Event Test");
    assert.equal(record!.enabled, true);

    // Trigger and record success
    scheduler.onTrigger = async () => {};
    await scheduler.runNow("event-test");
    scheduler.recordSuccess("event-test");

    const updated = schedulerStore.get("event-test");
    assert.ok(updated);
    assert.equal(updated!.runCount, 1);
    assert.ok(updated!.runHistory.length >= 1);
  });

  it("should wire built-in jobs to the scheduler", () => {
    const scheduler = new Scheduler();
    schedulers.push(scheduler);

    for (const job of builtInJobs) {
      scheduler.addJob(job);
    }

    const jobs = scheduler.listJobs();
    assert.ok(jobs.length >= 5, `Expected at least 5 built-in jobs, got ${jobs.length}`);

    const ids = jobs.map((j) => j.id);
    assert.ok(ids.includes("system-health"));
    assert.ok(ids.includes("connector-health"));
    assert.ok(ids.includes("daily-report"));
    assert.ok(ids.includes("knowledge-maintenance"));
    assert.ok(ids.includes("test-suite"));
  });

  it("should connect scheduler to EventBus", () => {
    const scheduler = new Scheduler();
    schedulers.push(scheduler);
    const eventBus = new EventBus();
    eventBus.connectScheduler(scheduler);

    const receivedEvents: unknown[] = [];
    eventBus.on("scheduler:event", (event) => receivedEvents.push(event));

    scheduler.addJob({
      id: "bus-test",
      name: "Bus Test",
      description: "",
      schedule: "*/5 * * * *",
      taskTemplate: {
        title: "Bus Check",
        description: "",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    assert.ok(receivedEvents.length > 0, "EventBus should receive scheduler events");

    eventBus.disconnectScheduler();
  });

  it("should auto-disable job after maxConsecutiveFailures and emit events", async () => {
    const scheduler = new Scheduler();
    schedulers.push(scheduler);
    const schedulerStore = new ScheduledJobStore();
    scheduler.on("event", (event) => schedulerStore.apply(event));

    scheduler.addJob({
      id: "fragile",
      name: "Fragile Job",
      description: "Will fail",
      schedule: "* * * * *",
      taskTemplate: {
        title: "Fragile",
        description: "",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 3,
    });

    // Trigger the job to get a runId
    scheduler.onTrigger = async () => {};
    await scheduler.runNow("fragile");
    scheduler.recordFailure("fragile", "error 1");

    await scheduler.runNow("fragile");
    scheduler.recordFailure("fragile", "error 2");

    await scheduler.runNow("fragile");
    scheduler.recordFailure("fragile", "error 3");

    // Should be auto-disabled
    const job = scheduler.getJob("fragile");
    assert.ok(job);
    assert.equal(job!.enabled, false);
    assert.equal(job!.nextRunAt, null);

    // Store should reflect disabled state
    const record = schedulerStore.get("fragile");
    assert.ok(record);
    assert.equal(record!.enabled, false);
  });

  it("should record success and reset consecutive failures via events", async () => {
    const scheduler = new Scheduler();
    schedulers.push(scheduler);
    const schedulerStore = new ScheduledJobStore();
    scheduler.on("event", (event) => schedulerStore.apply(event));

    scheduler.addJob({
      id: "recovery",
      name: "Recovery Job",
      description: "",
      schedule: "* * * * *",
      taskTemplate: {
        title: "Recovery",
        description: "",
        category: "monitoring",
        priority: "normal",
      },
      enabled: true,
      maxConcurrent: 1,
      catchUp: false,
      maxConsecutiveFailures: 5,
    });

    scheduler.onTrigger = async () => {};

    // Fail twice
    await scheduler.runNow("recovery");
    scheduler.recordFailure("recovery", "fail 1");
    await scheduler.runNow("recovery");
    scheduler.recordFailure("recovery", "fail 2");

    // Succeed once
    await scheduler.runNow("recovery");
    scheduler.recordSuccess("recovery");

    const record = schedulerStore.get("recovery");
    assert.ok(record);
    assert.equal(record!.consecutiveFailures, 0);
    assert.equal(record!.runCount, 3);
    assert.equal(record!.failCount, 2);
  });

  it("should handle custom job from config", () => {
    const scheduler = new Scheduler();
    schedulers.push(scheduler);

    // Simulate loading from config (like cli.ts does)
    const configJobs = [
      {
        id: "custom-check",
        name: "Custom Health Check",
        schedule: "*/30 * * * *",
        taskTemplate: { title: "Custom check", category: "monitoring" },
        enabled: true,
        maxConsecutiveFailures: 5,
      },
    ];

    for (const jobConfig of configJobs) {
      scheduler.addJob({
        id: jobConfig.id,
        name: jobConfig.name ?? jobConfig.id,
        description: "",
        schedule: jobConfig.schedule,
        taskTemplate: {
          title: jobConfig.taskTemplate?.title ?? jobConfig.id,
          description: jobConfig.taskTemplate?.description ?? "",
          category: (jobConfig.taskTemplate?.category as any) ?? "monitoring",
          priority: (jobConfig.taskTemplate?.priority as any) ?? "normal",
        },
        enabled: jobConfig.enabled !== false,
        maxConcurrent: 1,
        catchUp: false,
        maxConsecutiveFailures: jobConfig.maxConsecutiveFailures ?? 5,
      });
    }

    const job = scheduler.getJob("custom-check");
    assert.ok(job);
    assert.equal(job!.name, "Custom Health Check");
    assert.equal(job!.schedule, "*/30 * * * *");
    assert.ok(job!.nextRunAt); // has calculated next run
  });
});
