import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TaskRouter } from "./task-router";
import { AgentRegistry, type NormalizedTask, type TaskResult, type TaskSource } from "./agent-registry";
import { TaskQueueStore } from "../read-models/task-queue";
import { WebhookAdapter } from "./adapters/webhook-adapter";
import { ScheduleAdapter } from "./adapters/schedule-adapter";
import {
  TaskSubmitted,
  TaskAssigned,
  TaskStarted,
  TaskCompleted,
  type TaskEvent,
} from "../domain/task/events";

const silentLogger = { log: () => {}, error: () => {} };

describe("Integration: Adapter -> Router -> Agent -> Store", () => {
  it("should process a webhook task end-to-end", async () => {
    const registry = new AgentRegistry();
    registry.register({
      name: "coder",
      type: "claude-code",
      capabilities: ["code"],
      maxConcurrent: 1,
      available: true,
      execute: async (task: NormalizedTask): Promise<TaskResult> => ({
        success: true,
        output: { summary: "Fixed the bug" },
        filesChanged: ["src/fix.ts"],
        durationMs: 200,
      }),
    });

    const router = new TaskRouter({ registry, logger: silentLogger });
    const store = new TaskQueueStore();
    const allEvents: TaskEvent[] = [];

    router.on("event", (event: TaskEvent) => {
      store.apply(event);
      allEvents.push(event);
    });

    // Simulate webhook adapter emitting a task
    const source: TaskSource = {
      type: "webhook",
      id: "webhook-123",
      payload: { title: "Fix login bug", description: "Login fails on Safari" },
      receivedAt: new Date().toISOString(),
      priority: "high",
    };

    const task = router.submit(source, "Fix login bug", "Login fails on Safari", "code");

    // Wait for async execution
    await new Promise(r => setTimeout(r, 100));

    // Verify events were emitted in correct order
    assert.ok(allEvents.some(e => e instanceof TaskSubmitted));
    assert.ok(allEvents.some(e => e instanceof TaskAssigned));
    assert.ok(allEvents.some(e => e instanceof TaskStarted));
    assert.ok(allEvents.some(e => e instanceof TaskCompleted));

    // Verify store was updated
    const record = store.get(task.taskId)!;
    assert.ok(record);
    assert.equal(record.status, "completed");
    assert.equal(record.title, "Fix login bug");
    assert.equal(record.category, "code");
    assert.equal(record.priority, "high");
    assert.equal(record.assignedAgent, "coder");
    assert.deepEqual(record.result, { summary: "Fixed the bug" });
    assert.ok(record.durationMs !== null);
  });

  it("should process tasks from multiple sources simultaneously", async () => {
    const registry = new AgentRegistry();
    registry.register({
      name: "multi-agent",
      type: "test",
      capabilities: ["code", "monitoring", "operations"],
      maxConcurrent: 10,
      available: true,
      execute: async () => ({ success: true, output: "done", durationMs: 10 }),
    });

    const router = new TaskRouter({ registry, logger: silentLogger });
    const store = new TaskQueueStore();
    router.on("event", (event: TaskEvent) => store.apply(event));

    // Submit from different source types
    router.submit(
      { type: "github", id: "gh-1", payload: {}, receivedAt: new Date().toISOString(), priority: "normal" },
      "GitHub task", "From GitHub", "code"
    );
    router.submit(
      { type: "webhook", id: "wh-1", payload: {}, receivedAt: new Date().toISOString(), priority: "critical" },
      "Webhook task", "From webhook", "operations"
    );
    router.submit(
      { type: "schedule", id: "sch-1", payload: {}, receivedAt: new Date().toISOString(), priority: "low" },
      "Scheduled task", "From schedule", "monitoring"
    );

    await new Promise(r => setTimeout(r, 100));

    const all = store.getAll();
    assert.equal(all.length, 3);
    assert.ok(all.every(r => r.status === "completed"));
  });

  it("should route to correct agent based on capability", async () => {
    const executedBy: string[] = [];

    const registry = new AgentRegistry();
    registry.register({
      name: "coder",
      type: "claude-code",
      capabilities: ["code"],
      maxConcurrent: 5,
      available: true,
      execute: async () => { executedBy.push("coder"); return { success: true, output: null, durationMs: 10 }; },
    });
    registry.register({
      name: "browser",
      type: "browser",
      capabilities: ["research", "operations"],
      maxConcurrent: 5,
      available: true,
      execute: async () => { executedBy.push("browser"); return { success: true, output: null, durationMs: 10 }; },
    });

    const router = new TaskRouter({ registry, logger: silentLogger });
    const store = new TaskQueueStore();
    router.on("event", (event: TaskEvent) => store.apply(event));

    router.submit(
      { type: "webhook", id: "w1", payload: {}, receivedAt: new Date().toISOString() },
      "Code task", "desc", "code"
    );
    router.submit(
      { type: "webhook", id: "w2", payload: {}, receivedAt: new Date().toISOString() },
      "Research task", "desc", "research"
    );

    await new Promise(r => setTimeout(r, 100));

    assert.ok(executedBy.includes("coder"));
    assert.ok(executedBy.includes("browser"));

    const all = store.getAll();
    const codeTask = all.find(r => r.title === "Code task");
    const researchTask = all.find(r => r.title === "Research task");
    assert.equal(codeTask?.assignedAgent, "coder");
    assert.equal(researchTask?.assignedAgent, "browser");
  });
});
