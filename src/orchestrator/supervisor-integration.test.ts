import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AgentSupervisor, type ManagedAgent, type AgentContext, type AgentHeartbeat } from "./supervisor";
import { AgentProcessStore } from "../read-models/agent-processes";
import { ConcurrencyManager } from "./concurrency";
import type { NormalizedTask } from "./agent-registry";
import type { AgentProcessEvent } from "../domain/agent-process/events";

function makeTask(overrides?: Partial<NormalizedTask>): NormalizedTask {
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
    ...overrides,
  };
}

class HeartbeatingAgent implements ManagedAgent {
  name = "hb-agent";
  type = "hb";
  private context: AgentContext | null = null;
  private done = false;

  async start(_task: NormalizedTask, context: AgentContext): Promise<void> {
    this.context = context;
    // Heartbeat a few times then complete
    for (let i = 0; i < 3; i++) {
      context.reportHeartbeat();
      context.reportProgress(`step ${i + 1}`);
      await new Promise(r => setTimeout(r, 10));
    }
    this.done = true;
  }

  async heartbeat(): Promise<AgentHeartbeat> {
    return { alive: !this.done, progress: "working", percentComplete: null };
  }

  async stop(): Promise<void> { this.done = true; }
  kill(): void { this.done = true; }
}

describe("Supervisor Integration", () => {
  let supervisor: AgentSupervisor;

  afterEach(async () => {
    if (supervisor) await supervisor.shutdown(200);
  });

  it("should wire supervisor events to AgentProcessStore", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 5, retainWorkDirs: true });
    const store = new AgentProcessStore();

    // Wire events
    supervisor.on("event", (event: AgentProcessEvent) => store.apply(event));

    const agent = new HeartbeatingAgent();
    const proc = await supervisor.spawn(agent, makeTask());
    assert.ok(proc);

    // Wait for agent to complete
    await new Promise(r => setTimeout(r, 200));

    // Store should have tracked the full lifecycle
    const record = store.get(proc.processId);
    assert.ok(record);
    assert.equal(record.agentName, "hb-agent");
    assert.equal(record.taskId, "task-1");
    assert.equal(record.status, "completed");
    assert.ok(record.durationMs !== null && record.durationMs > 0);
  });

  it("should track multiple agents simultaneously", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 5, retainWorkDirs: true });
    const store = new AgentProcessStore();
    supervisor.on("event", (event: AgentProcessEvent) => store.apply(event));

    const agents = [new HeartbeatingAgent(), new HeartbeatingAgent(), new HeartbeatingAgent()];
    agents[0].name = "agent-1";
    agents[1].name = "agent-2";
    agents[2].name = "agent-3";

    await supervisor.spawn(agents[0], makeTask({ taskId: "t1" }));
    await supervisor.spawn(agents[1], makeTask({ taskId: "t2" }));
    await supervisor.spawn(agents[2], makeTask({ taskId: "t3" }));

    // Wait for all to complete
    await new Promise(r => setTimeout(r, 300));

    assert.equal(store.getAll().length, 3);
    const util = store.utilization();
    assert.equal(util.completed, 3);
    assert.equal(util.running, 0);
  });

  it("should update read model on agent failure", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 5, retainWorkDirs: true });
    const store = new AgentProcessStore();
    supervisor.on("event", (event: AgentProcessEvent) => store.apply(event));

    const agent: ManagedAgent = {
      name: "fail-agent",
      type: "fail",
      async start() { throw new Error("oops"); },
      async heartbeat() { return { alive: false, progress: "", percentComplete: null }; },
      async stop() {},
      kill() {},
    };

    await supervisor.spawn(agent, makeTask());
    await new Promise(r => setTimeout(r, 50));

    const util = store.utilization();
    assert.equal(util.failed, 1);
  });

  it("should update read model on agent kill", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 5, retainWorkDirs: true });
    const store = new AgentProcessStore();
    supervisor.on("event", (event: AgentProcessEvent) => store.apply(event));

    const agent: ManagedAgent = {
      name: "long-agent",
      type: "long",
      start: () => new Promise(() => {}), // never resolves
      async heartbeat() { return { alive: true, progress: "", percentComplete: null }; },
      async stop() {},
      kill() {},
    };

    const proc = await supervisor.spawn(agent, makeTask());
    assert.ok(proc);

    await supervisor.killAgent(proc.processId, "manual kill");

    const record = store.get(proc.processId);
    assert.ok(record);
    assert.equal(record.status, "killed");
    assert.equal(record.reason, "manual kill");
  });

  it("should reflect concurrency manager state", () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 5 });
    supervisor.concurrency.setLimit("code", 2);
    supervisor.concurrency.setLimit("research", 3);

    const util = supervisor.concurrency.utilization();
    assert.equal(util.max, 5);
    assert.equal(util.total, 0);
    assert.equal(util.byType.code.max, 2);
    assert.equal(util.byType.research.max, 3);
  });
});
