import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ManagedClaudeCodeAgent } from "./managed-claude-code-agent";
import type { AgentContext, AgentHeartbeat } from "../orchestrator/supervisor";
import type { NormalizedTask } from "../orchestrator/agent-registry";

function makeTask(): NormalizedTask {
  return {
    taskId: "task-1",
    source: { type: "manual", id: "m1", payload: {}, receivedAt: "2026-03-01T10:00:00Z" },
    title: "Test task",
    description: "A test task",
    category: "code",
    priority: "normal",
    assignedAgent: null,
    status: "queued",
    createdAt: "2026-03-01T10:00:00Z",
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
  };
}

function makeContext(): AgentContext {
  return {
    processId: "proc-1",
    workDir: "/tmp/test-work",
    reportProgress: () => {},
    reportHeartbeat: () => {},
  };
}

describe("ManagedClaudeCodeAgent", () => {
  it("should implement ManagedAgent interface", () => {
    const agent = new ManagedClaudeCodeAgent();
    assert.equal(agent.name, "claude-code");
    assert.equal(agent.type, "claude-code");
    assert.equal(typeof agent.start, "function");
    assert.equal(typeof agent.heartbeat, "function");
    assert.equal(typeof agent.stop, "function");
    assert.equal(typeof agent.kill, "function");
  });

  it("should accept custom name", () => {
    const agent = new ManagedClaudeCodeAgent({ name: "custom-claude" });
    assert.equal(agent.name, "custom-claude");
  });

  it("should report not alive before start", async () => {
    const agent = new ManagedClaudeCodeAgent();
    const hb = await agent.heartbeat();
    assert.equal(hb.alive, false);
    assert.equal(hb.percentComplete, null);
  });

  it("should handle kill before start gracefully", () => {
    const agent = new ManagedClaudeCodeAgent();
    // Should not throw
    agent.kill();
  });

  it("should handle stop before start gracefully", async () => {
    const agent = new ManagedClaudeCodeAgent();
    // Should not throw
    await agent.stop();
  });
});
