import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry, type AgentDefinition, type NormalizedTask, type TaskResult } from "./agent-registry";

function makeDummyAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "test-agent",
    type: "test",
    capabilities: ["code"],
    maxConcurrent: 2,
    available: true,
    execute: async () => ({ success: true, output: null, durationMs: 0 }),
    ...overrides,
  };
}

describe("AgentRegistry", () => {
  it("should register and retrieve an agent", () => {
    const registry = new AgentRegistry();
    const agent = makeDummyAgent();
    registry.register(agent);
    assert.equal(registry.getAgent("test-agent"), agent);
  });

  it("should unregister an agent", () => {
    const registry = new AgentRegistry();
    registry.register(makeDummyAgent());
    registry.unregister("test-agent");
    assert.equal(registry.getAgent("test-agent"), undefined);
  });

  it("should find agent by capability", () => {
    const registry = new AgentRegistry();
    registry.register(makeDummyAgent({ name: "coder", capabilities: ["code"] }));
    registry.register(makeDummyAgent({ name: "browser", capabilities: ["research", "operations"] }));

    const coder = registry.findAgent("code");
    assert.equal(coder?.name, "coder");

    const browser = registry.findAgent("research");
    assert.equal(browser?.name, "browser");
  });

  it("should return null if no agent can handle category", () => {
    const registry = new AgentRegistry();
    registry.register(makeDummyAgent({ capabilities: ["code"] }));
    assert.equal(registry.findAgent("communication"), null);
  });

  it("should return null if agent is not available", () => {
    const registry = new AgentRegistry();
    registry.register(makeDummyAgent({ available: false }));
    assert.equal(registry.findAgent("code"), null);
  });

  it("should respect maxConcurrent", () => {
    const registry = new AgentRegistry();
    registry.register(makeDummyAgent({ maxConcurrent: 1 }));

    assert.ok(registry.findAgent("code"));
    registry.markRunning("test-agent");
    assert.equal(registry.findAgent("code"), null);
  });

  it("should track utilization with markRunning/markDone", () => {
    const registry = new AgentRegistry();
    registry.register(makeDummyAgent({ maxConcurrent: 3 }));

    registry.markRunning("test-agent");
    registry.markRunning("test-agent");

    const agents = registry.listAgents();
    assert.equal(agents[0].runningTasks, 2);

    registry.markDone("test-agent");
    const agents2 = registry.listAgents();
    assert.equal(agents2[0].runningTasks, 1);
  });

  it("should not go below 0 running tasks", () => {
    const registry = new AgentRegistry();
    registry.register(makeDummyAgent());
    registry.markDone("test-agent");
    const agents = registry.listAgents();
    assert.equal(agents[0].runningTasks, 0);
  });

  it("should list all agents with utilization", () => {
    const registry = new AgentRegistry();
    registry.register(makeDummyAgent({ name: "a", capabilities: ["code"] }));
    registry.register(makeDummyAgent({ name: "b", capabilities: ["research"] }));

    const agents = registry.listAgents();
    assert.equal(agents.length, 2);
    assert.equal(agents[0].name, "a");
    assert.equal(agents[1].name, "b");
  });
});
