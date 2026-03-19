/**
 * E2E Integration Test: Orchestrator full task lifecycle.
 *
 * Verifies the complete flow:
 *   task submitted -> queued -> assigned -> agent spawned -> completed -> knowledge extracted
 *
 * Uses mock agents (no real Claude Code) and in-memory stores.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { AgentSupervisor } from "../../src/orchestrator/supervisor";
import { AgentRegistry, type NormalizedTask, type TaskResult, type TaskSource } from "../../src/orchestrator/agent-registry";
import { TaskRouter } from "../../src/orchestrator/task-router";
import { TaskQueueStore } from "../../src/read-models/task-queue";
import { AgentProcessStore } from "../../src/read-models/agent-processes";
import { InMemoryKnowledgeStore } from "../../src/knowledge/in-memory-store";
import { taskToIssueContext } from "../../src/orchestrator/task-adapter";
import type { ManagedAgent, AgentContext, AgentHeartbeat } from "../../src/orchestrator/supervisor";
import type { KnowledgeExtractor, ExtractedEntry, ExtractionContext } from "../../src/knowledge/extractor";

// ── Mock Agent ──────────────────────────────────────────────────────

class MockManagedAgent implements ManagedAgent {
  readonly name: string;
  readonly type = "claude-code";
  startCalled = false;
  taskReceived: NormalizedTask | null = null;
  private resolveCompletion: (() => void) | null = null;

  constructor(name = "mock-claude-code") {
    this.name = name;
  }

  async start(task: NormalizedTask, context: AgentContext): Promise<void> {
    this.startCalled = true;
    this.taskReceived = task;
    context.reportProgress("Mock agent started");
    context.reportHeartbeat();
    // Simulate brief work
    await new Promise((r) => setTimeout(r, 50));
    context.reportProgress("Mock agent completed work");
  }

  async heartbeat(): Promise<AgentHeartbeat> {
    return { alive: true, progress: "working", percentComplete: 50 };
  }

  async stop(): Promise<void> {}
  kill(): void {}
}

// ── Mock Knowledge Extractor ────────────────────────────────────────

class MockKnowledgeExtractor implements KnowledgeExtractor {
  extractCalled = false;
  lastContext: ExtractionContext | null = null;

  async extract(context: ExtractionContext): Promise<ExtractedEntry[]> {
    this.extractCalled = true;
    this.lastContext = context;
    return [{
      type: "solution",
      title: `Solution for: ${context.taskTitle}`,
      content: "Mock extracted knowledge",
      source: {
        taskId: context.taskId,
        agentName: context.agentName,
        timestamp: new Date().toISOString(),
      },
      tags: ["mock", "test"],
      relatedFiles: context.filesModified,
      confidence: 0.85,
      supersededBy: null,
    }];
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeWebhookSource(overrides: Partial<TaskSource> = {}): TaskSource {
  return {
    type: "webhook",
    id: `webhook-${Date.now()}`,
    payload: { title: "Test task", description: "Test description" },
    receivedAt: new Date().toISOString(),
    priority: "normal",
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Orchestrator E2E: full task lifecycle", () => {
  let supervisor: AgentSupervisor;
  let registry: AgentRegistry;
  let taskRouter: TaskRouter;
  let taskStore: TaskQueueStore;
  let agentStore: AgentProcessStore;
  let knowledgeStore: InMemoryKnowledgeStore;
  let mockExtractor: MockKnowledgeExtractor;
  let mockAgent: MockManagedAgent;

  beforeEach(() => {
    supervisor = new AgentSupervisor({
      maxTotalAgents: 3,
      heartbeatIntervalMs: 60_000,
      heartbeatTimeoutMs: 60_000,
      taskTimeoutMs: 30_000,
      cleanupIntervalMs: 60_000,
    });

    agentStore = new AgentProcessStore();
    supervisor.on("event", (event) => agentStore.apply(event));

    knowledgeStore = new InMemoryKnowledgeStore();
    mockExtractor = new MockKnowledgeExtractor();
    mockAgent = new MockManagedAgent();

    registry = new AgentRegistry();
    registry.register({
      name: "mock-claude-code",
      type: "claude-code",
      capabilities: ["code"],
      maxConcurrent: 2,
      available: true,
      execute: createMockExecutor(supervisor, mockAgent, knowledgeStore, mockExtractor),
    });

    taskRouter = new TaskRouter({
      registry,
      logger: { log: () => {}, error: () => {} },
    });

    taskStore = new TaskQueueStore();
    taskRouter.on("event", (event) => taskStore.apply(event));
  });

  it("submits task and processes it through full lifecycle", async () => {
    const source = makeWebhookSource();
    const task = taskRouter.submit(source, "Fix authentication bug", "Users locked out", "code");

    assert.ok(task.taskId);
    assert.equal(task.status, "running"); // immediately routed + started

    // Wait for agent to complete
    await waitForTaskStatus(taskStore, task.taskId, "completed", 5000);

    const record = taskStore.get(task.taskId);
    assert.ok(record);
    assert.equal(record!.status, "completed");
    assert.ok(record!.completedAt);
  });

  it("records supervisor events in AgentProcessStore", async () => {
    const source = makeWebhookSource();
    const task = taskRouter.submit(source, "Add new feature", "Add dark mode", "code");

    await waitForTaskStatus(taskStore, task.taskId, "completed", 5000);

    const processes = agentStore.list();
    assert.ok(processes.length > 0, "Should have at least one agent process");

    const proc = processes[0];
    assert.equal(proc.agentName, "mock-claude-code");
    assert.equal(proc.status, "completed");
    assert.ok(proc.startedAt);
    assert.ok(proc.completedAt);
  });

  it("records task events in TaskQueueStore", async () => {
    const source = makeWebhookSource();
    const task = taskRouter.submit(source, "Refactor module", "Clean up utils", "code");

    await waitForTaskStatus(taskStore, task.taskId, "completed", 5000);

    const record = taskStore.get(task.taskId);
    assert.ok(record);
    assert.equal(record!.title, "Refactor module");
    assert.equal(record!.category, "code");
    assert.equal(record!.status, "completed");
  });

  it("attempts knowledge extraction after task completion", async () => {
    const source = makeWebhookSource();
    const task = taskRouter.submit(source, "Fix memory leak", "Memory grows over time", "code");

    await waitForTaskStatus(taskStore, task.taskId, "completed", 5000);

    // Give async knowledge extraction a moment to complete
    await new Promise((r) => setTimeout(r, 200));

    assert.ok(mockExtractor.extractCalled, "Knowledge extraction should be attempted");
    assert.ok(mockExtractor.lastContext);
    assert.equal(mockExtractor.lastContext!.taskTitle, "Fix memory leak");
  });

  it("stores extracted knowledge in knowledge store", async () => {
    const source = makeWebhookSource();
    const task = taskRouter.submit(source, "Fix database query", "Slow query on users table", "code");

    await waitForTaskStatus(taskStore, task.taskId, "completed", 5000);
    await new Promise((r) => setTimeout(r, 200));

    const stats = await knowledgeStore.stats();
    assert.ok(stats.totalEntries > 0, "Knowledge store should have entries after extraction");
  });

  it("queries knowledge store before task execution", async () => {
    // Pre-populate knowledge
    await knowledgeStore.add({
      type: "solution",
      title: "Auth fix pattern",
      content: "Use JWT refresh tokens",
      source: { taskId: "old-1", agentName: "claude-code", timestamp: new Date().toISOString() },
      tags: ["auth", "jwt"],
      relatedFiles: ["src/auth.ts"],
      confidence: 0.9,
      supersededBy: null,
    });

    const source = makeWebhookSource();
    const task = taskRouter.submit(source, "Fix auth token refresh", "Tokens expire too fast", "code");

    await waitForTaskStatus(taskStore, task.taskId, "completed", 5000);

    // Check that knowledge was accessed (usage count > 0)
    const entries = await knowledgeStore.search("auth token");
    assert.ok(entries.length > 0);
    assert.ok(entries[0].usageCount > 0, "Prior knowledge should have been accessed");
  });

  it("handles multiple concurrent tasks", async () => {
    // Submit 2 tasks (matches maxConcurrent: 2 on the mock agent)
    const tasks = [];
    for (let i = 0; i < 2; i++) {
      const source = makeWebhookSource({ id: `webhook-concurrent-${i}` });
      tasks.push(taskRouter.submit(source, `Concurrent task ${i}`, `Task ${i} desc`, "code"));
    }

    // Wait for both to complete
    for (const task of tasks) {
      await waitForTaskStatus(taskStore, task.taskId, "completed", 5000);
    }

    // Submit a third after slots free up
    const source3 = makeWebhookSource({ id: `webhook-concurrent-2` });
    const task3 = taskRouter.submit(source3, "Concurrent task 2", "Task 2 desc", "code");
    await waitForTaskStatus(taskStore, task3.taskId, "completed", 5000);

    const records = taskStore.list();
    const completed = records.filter((r) => r.status === "completed");
    assert.ok(completed.length >= 3, `Expected 3 completed, got ${completed.length}`);
  });

  it("supervisor utilization reflects agent processes", async () => {
    const source = makeWebhookSource();
    taskRouter.submit(source, "Util test", "Check utilization", "code");

    // Small delay to let agent spawn
    await new Promise((r) => setTimeout(r, 20));

    const utilization = agentStore.utilization();
    assert.ok(utilization.total > 0);
  });

  it("taskToIssueContext integration works end-to-end", () => {
    const task: NormalizedTask = {
      taskId: "abcdef01-2345-6789-abcd-ef0123456789",
      source: makeWebhookSource(),
      title: "Test issue conversion",
      description: "Verify conversion works",
      category: "code",
      priority: "high",
      assignedAgent: null,
      status: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      retryCount: 0,
      maxRetries: 3,
    };

    const ctx = taskToIssueContext(task);
    assert.equal(ctx.title, "Test issue conversion");
    assert.equal(ctx.description, "Verify conversion works");
    assert.deepEqual(ctx.labels, ["code", "high"]);
    assert.ok(typeof ctx.number === "number");
  });
});

// ── Test Utilities ──────────────────────────────────────────────────

function createMockExecutor(
  supervisor: AgentSupervisor,
  mockAgent: MockManagedAgent,
  knowledgeStore: InMemoryKnowledgeStore,
  extractor: MockKnowledgeExtractor,
): (task: NormalizedTask) => Promise<TaskResult> {
  return async (task: NormalizedTask): Promise<TaskResult> => {
    const startTime = Date.now();

    // Search prior knowledge
    try {
      const query = `${task.title} ${task.description.slice(0, 500)}`;
      const entries = await knowledgeStore.search(query, { limit: 5, minConfidence: 0.5 });
      for (const entry of entries) {
        await knowledgeStore.recordUsage(entry.id);
      }
    } catch { /* best-effort */ }

    // Create fresh mock agent for each task
    const agent = new MockManagedAgent(mockAgent.name);
    const proc = await supervisor.spawn(agent, task);

    if (!proc) {
      return {
        success: false,
        output: null,
        error: "Failed to spawn",
        durationMs: Date.now() - startTime,
      };
    }

    // Wait for completion
    const result = await pollCompletion(supervisor, proc.processId, 5000);

    // Extract knowledge on success
    if (result.success) {
      try {
        const entries = await extractor.extract({
          taskId: task.taskId,
          taskTitle: task.title,
          taskDescription: task.description,
          agentName: agent.name,
          gitDiff: "",
          agentOutput: proc.output.join("\n"),
          filesModified: [],
        });
        for (const entry of entries) {
          await knowledgeStore.add(entry);
        }
      } catch { /* best-effort */ }
    }

    return { ...result, durationMs: Date.now() - startTime };
  };
}

async function pollCompletion(
  supervisor: AgentSupervisor,
  processId: string,
  timeoutMs: number,
): Promise<TaskResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const proc = supervisor.getProcess(processId);
    if (!proc) return { success: false, output: null, error: "Process not found", durationMs: 0 };
    if (proc.status === "completed") return { success: true, output: { message: "done" }, durationMs: 0 };
    if (proc.status === "failed") return { success: false, output: null, error: "Agent failed", durationMs: 0 };
    if (proc.status === "killed") return { success: false, output: null, error: "Agent killed", durationMs: 0 };
    await new Promise((r) => setTimeout(r, 50));
  }
  return { success: false, output: null, error: "Timeout", durationMs: 0 };
}

async function waitForTaskStatus(
  store: TaskQueueStore,
  taskId: string,
  status: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const record = store.get(taskId);
    if (record && record.status === status) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  const record = store.get(taskId);
  throw new Error(`Task ${taskId} did not reach status "${status}" within ${timeoutMs}ms (current: ${record?.status ?? "not found"})`);
}
