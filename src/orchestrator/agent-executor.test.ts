import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createAgentExecutor, deriveKnowledgeScope, enrichTaskWithPriorKnowledge, type AgentExecutorConfig } from "./agent-executor";
import { AgentSupervisor } from "./supervisor";
import type { NormalizedTask, TaskResult } from "./agent-registry";
import { InMemoryKnowledgeStore } from "../knowledge/in-memory-store";
import type { KnowledgeExtractor, ExtractedEntry, ExtractionContext } from "../knowledge/extractor";

function makeTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    taskId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    source: {
      type: "webhook",
      id: "src-1",
      payload: {},
      receivedAt: new Date().toISOString(),
    },
    title: "Test task",
    description: "A test task description",
    category: "code",
    priority: "normal",
    assignedAgent: null,
    status: "running",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

describe("createAgentExecutor", () => {
  it("returns a function", () => {
    const supervisor = new AgentSupervisor({ maxTotalAgents: 1 });
    const executor = createAgentExecutor({
      supervisor,
      workDir: process.cwd(),
    });
    assert.equal(typeof executor, "function");
  });

  it("returns failure when supervisor cannot spawn (concurrency full)", async () => {
    const supervisor = new AgentSupervisor({ maxTotalAgents: 0 });
    const executor = createAgentExecutor({
      supervisor,
      workDir: process.cwd(),
    });

    const task = makeTask();
    const result = await executor(task);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("concurrency limit"));
  });

  it("returns success when agent completes via supervisor", async () => {
    const supervisor = new AgentSupervisor({
      maxTotalAgents: 2,
      heartbeatTimeoutMs: 60_000,
      taskTimeoutMs: 60_000,
      cleanupIntervalMs: 60_000,
    });

    // Mock the ManagedClaudeCodeAgent import to use a fast mock agent
    const executor = createMockAgentExecutor(supervisor, "success");
    const task = makeTask();
    const result = await executor(task);

    assert.equal(result.success, true);
    assert.ok(result.durationMs >= 0);
    await supervisor.shutdown(1000);
  });

  it("returns failure when agent fails via supervisor", async () => {
    const supervisor = new AgentSupervisor({
      maxTotalAgents: 2,
      heartbeatTimeoutMs: 60_000,
      taskTimeoutMs: 60_000,
      cleanupIntervalMs: 60_000,
    });

    const executor = createMockAgentExecutor(supervisor, "fail");
    const task = makeTask();
    const result = await executor(task);

    assert.equal(result.success, false);
    assert.ok(result.error);
    await supervisor.shutdown(1000);
  });

  it("searches knowledge store before execution with task scope", async () => {
    const knowledgeStore = new InMemoryKnowledgeStore();
    const matchingId = await knowledgeStore.add({
      type: "solution",
      title: "Login fix pattern",
      content: "Use bcrypt for password hashing",
      source: { taskId: "prev-1", agentName: "claude-code", timestamp: new Date().toISOString() },
      tags: ["login", "auth"],
      relatedFiles: ["src/auth.ts"],
      scope: { tenant: "acme", workflowType: "password-reset" },
      confidence: 0.9,
      supersededBy: null,
    });
    const otherTenantId = await knowledgeStore.add({
      type: "solution",
      title: "Login fix pattern",
      content: "Reset credentials in a different tenant",
      source: { taskId: "prev-2", agentName: "claude-code", timestamp: new Date().toISOString() },
      tags: ["login", "auth"],
      relatedFiles: ["src/auth.ts"],
      scope: { tenant: "globex", workflowType: "password-reset" },
      confidence: 0.9,
      supersededBy: null,
    });

    const supervisor = new AgentSupervisor({
      maxTotalAgents: 2,
      heartbeatTimeoutMs: 60_000,
      taskTimeoutMs: 60_000,
      cleanupIntervalMs: 60_000,
    });

    const executor = createMockAgentExecutor(supervisor, "success", {
      knowledgeStore,
    });

    const task = makeTask({
      title: "Fix login auth bug",
      source: {
        type: "webhook",
        id: "src-1",
        payload: {},
        receivedAt: new Date().toISOString(),
        metadata: { tenant: "acme", workflowType: "password-reset" },
      },
    });
    const result = await executor(task);

    assert.equal(result.success, true);

    const matchingEntry = await knowledgeStore.get(matchingId);
    const otherTenantEntry = await knowledgeStore.get(otherTenantId);
    assert.equal(matchingEntry?.usageCount, 1);
    assert.equal(otherTenantEntry?.usageCount, 0);

    await supervisor.shutdown(1000);
  });

  it("extracts knowledge after successful completion", async () => {
    const knowledgeStore = new InMemoryKnowledgeStore();
    const extractedEntries: ExtractedEntry[] = [{
      type: "solution",
      title: "Extracted pattern",
      content: "Pattern from completed task",
      source: { taskId: "t1", agentName: "claude-code", timestamp: new Date().toISOString() },
      tags: ["test"],
      relatedFiles: [],
      confidence: 0.8,
      supersededBy: null,
    }];

    const knowledgeExtractor: KnowledgeExtractor = {
      async extract(_ctx: ExtractionContext): Promise<ExtractedEntry[]> {
        return extractedEntries;
      },
    };

    const supervisor = new AgentSupervisor({
      maxTotalAgents: 2,
      heartbeatTimeoutMs: 60_000,
      taskTimeoutMs: 60_000,
      cleanupIntervalMs: 60_000,
    });

    const executor = createMockAgentExecutor(supervisor, "success", {
      knowledgeStore,
      knowledgeExtractor,
    });

    const task = makeTask();
    const result = await executor(task);

    assert.equal(result.success, true);

    // Verify knowledge was extracted and stored
    const stats = await knowledgeStore.stats();
    assert.ok(stats.totalEntries > 0);

    await supervisor.shutdown(1000);
  });

  it("derives knowledge scope from task metadata", () => {
    const scope = deriveKnowledgeScope(makeTask({
      source: {
        type: "webhook",
        id: "src-1",
        payload: { ticket: { queueName: "Service Desk" } },
        receivedAt: new Date().toISOString(),
        metadata: { customer: "Acme", workflow: "Password-Reset" },
      },
    }));

    assert.deepEqual(scope, {
      tenant: "acme",
      workflowType: "password-reset",
      queue: "service desk",
    });
  });

  it("injects prior knowledge into the managed task description", () => {
    const task = makeTask({ description: "Implement the login fix." });
    const enriched = enrichTaskWithPriorKnowledge(task, [
      "[solution] Login fix pattern: Reuse the auth service instead of inlining validation.",
    ]);

    assert.match(enriched.description, /## Prior Knowledge/);
    assert.match(enriched.description, /Login fix pattern/);
    assert.match(enriched.description, /Implement the login fix\./);
  });
});

/**
 * Create an executor that uses a mock agent instead of real Claude Code.
 * The mock agent resolves immediately (success) or rejects (fail).
 */
function createMockAgentExecutor(
  supervisor: AgentSupervisor,
  outcome: "success" | "fail",
  extraConfig: Partial<AgentExecutorConfig> = {},
): (task: NormalizedTask) => Promise<TaskResult> {
  // We directly use the supervisor.spawn with a mock ManagedAgent,
  // bypassing the real createAgentExecutor's dynamic import.
  return async (task: NormalizedTask): Promise<TaskResult> => {
    const startTime = Date.now();

    // Search knowledge if configured
    if (extraConfig.knowledgeStore) {
      try {
        const query = `${task.title} ${task.description.slice(0, 500)}`;
        const entries = await extraConfig.knowledgeStore.search(query, {
          limit: 5,
          minConfidence: 0.5,
          scope: deriveKnowledgeScope(task),
        });
        for (const entry of entries) {
          await extraConfig.knowledgeStore.recordUsage(entry.id);
        }
      } catch { /* best-effort */ }
    }

    // Create mock managed agent
    const mockAgent = {
      name: "mock-agent",
      type: "claude-code",
      start: async () => {
        if (outcome === "fail") {
          throw new Error("Mock agent failure");
        }
        // Simulate brief work
        await new Promise((r) => setTimeout(r, 50));
      },
      heartbeat: async () => ({ alive: true, progress: "working", percentComplete: null }),
      stop: async () => {},
      kill: () => {},
    };

    const proc = await supervisor.spawn(mockAgent, task);
    if (!proc) {
      return {
        success: false,
        output: null,
        error: "Failed to spawn agent - concurrency limit reached or supervisor shutting down",
        durationMs: Date.now() - startTime,
      };
    }

    // Wait for completion
    const POLL_INTERVAL = 50;
    const MAX_WAIT = 10_000;
    const start = Date.now();

    while (Date.now() - start < MAX_WAIT) {
      const p = supervisor.getProcess(proc.processId);
      if (!p) break;
      if (p.status === "completed") {
        // Extract knowledge if configured
        if (extraConfig.knowledgeExtractor && extraConfig.knowledgeStore) {
          try {
            const entries = await extraConfig.knowledgeExtractor.extract({
              taskId: task.taskId,
              taskTitle: task.title,
              taskDescription: task.description,
              agentName: "mock-agent",
              gitDiff: "",
              agentOutput: "",
              filesModified: [],
            });
            for (const entry of entries) {
              await extraConfig.knowledgeStore.add({
                ...entry,
                scope: deriveKnowledgeScope(task),
              });
            }
          } catch { /* best-effort */ }
        }
        return {
          success: true,
          output: { message: "Agent completed" },
          filesChanged: [],
          durationMs: Date.now() - startTime,
        };
      }
      if (p.status === "failed" || p.status === "killed" || p.status === "hung") {
        return {
          success: false,
          output: null,
          error: `Agent ${p.status}`,
          durationMs: Date.now() - startTime,
        };
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    return {
      success: false,
      output: null,
      error: "Timed out waiting for agent",
      durationMs: Date.now() - startTime,
    };
  };
}
