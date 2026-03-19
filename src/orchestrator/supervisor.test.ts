import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AgentSupervisor, type ManagedAgent, type AgentContext, type AgentHeartbeat } from "./supervisor";
import type { NormalizedTask } from "./agent-registry";
import {
  AgentSpawned,
  AgentCompleted,
  AgentFailed,
  AgentHung,
  AgentKilled,
} from "../domain/agent-process/events";

// ── Test helpers ────────────────────────────────────────────────────

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

class FakeAgent implements ManagedAgent {
  name: string;
  type: string;
  started = false;
  stopped = false;
  killed = false;
  private resolveStart: (() => void) | null = null;
  private rejectStart: ((err: Error) => void) | null = null;

  constructor(name = "fake-agent", type = "fake") {
    this.name = name;
    this.type = type;
  }

  start(_task: NormalizedTask, _context: AgentContext): Promise<void> {
    this.started = true;
    return new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
  }

  async heartbeat(): Promise<AgentHeartbeat> {
    return { alive: this.started && !this.stopped && !this.killed, progress: "working", percentComplete: null };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.resolveStart?.();
  }

  kill(): void {
    this.killed = true;
    this.resolveStart?.();
  }

  /** Simulate completion */
  complete(): void {
    this.resolveStart?.();
  }

  /** Simulate failure */
  fail(msg: string): void {
    this.rejectStart?.(new Error(msg));
  }
}

/** Instantly completing agent */
class InstantAgent implements ManagedAgent {
  name = "instant";
  type = "instant";
  async start(): Promise<void> { /* resolves immediately */ }
  async heartbeat(): Promise<AgentHeartbeat> { return { alive: false, progress: "done", percentComplete: 100 }; }
  async stop(): Promise<void> {}
  kill(): void {}
}

/** Agent that fails immediately */
class FailingAgent implements ManagedAgent {
  name = "failing";
  type = "failing";
  async start(): Promise<void> { throw new Error("boom"); }
  async heartbeat(): Promise<AgentHeartbeat> { return { alive: false, progress: "", percentComplete: null }; }
  async stop(): Promise<void> {}
  kill(): void {}
}

// ── Tests ───────────────────────────────────────────────────────────

describe("AgentSupervisor", () => {
  let supervisor: AgentSupervisor;

  afterEach(async () => {
    if (supervisor) await supervisor.shutdown(100);
  });

  it("should spawn an agent and emit AgentSpawned event", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 3, retainWorkDirs: true });
    supervisor.concurrency.setLimit("fake", 2);

    const events: unknown[] = [];
    supervisor.on("event", (e: unknown) => events.push(e));

    const agent = new FakeAgent();
    const proc = await supervisor.spawn(agent, makeTask());

    assert.ok(proc);
    assert.equal(proc.agentName, "fake-agent");
    assert.equal(proc.taskId, "task-1");
    assert.equal(proc.status, "running");
    assert.ok(events.some(e => e instanceof AgentSpawned));

    agent.complete();
  });

  it("should track agent completion with AgentCompleted event", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 3, retainWorkDirs: true });

    const events: unknown[] = [];
    supervisor.on("event", (e: unknown) => events.push(e));

    const agent = new InstantAgent();
    await supervisor.spawn(agent, makeTask());

    // Wait for async completion
    await new Promise(r => setTimeout(r, 50));

    assert.ok(events.some(e => e instanceof AgentCompleted));
  });

  it("should track agent failure with AgentFailed event", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 3, retainWorkDirs: true });

    const events: unknown[] = [];
    supervisor.on("event", (e: unknown) => events.push(e));

    const agent = new FailingAgent();
    await supervisor.spawn(agent, makeTask());

    await new Promise(r => setTimeout(r, 50));

    assert.ok(events.some(e => e instanceof AgentFailed));
  });

  it("should respect concurrency limits", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 2, retainWorkDirs: true });
    supervisor.concurrency.setLimit("fake", 5);

    const a1 = new FakeAgent("a1", "fake");
    const a2 = new FakeAgent("a2", "fake");
    const a3 = new FakeAgent("a3", "fake");

    const p1 = await supervisor.spawn(a1, makeTask({ taskId: "t1" }));
    const p2 = await supervisor.spawn(a2, makeTask({ taskId: "t2" }));
    const p3 = await supervisor.spawn(a3, makeTask({ taskId: "t3" }));

    assert.ok(p1);
    assert.ok(p2);
    assert.equal(p3, null); // at global limit

    a1.complete();
    a2.complete();
  });

  it("should capture output in ring buffer (max 100 lines)", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 3, retainWorkDirs: true });

    let capturedContext: AgentContext | null = null;
    const agent: ManagedAgent = {
      name: "output-test",
      type: "test",
      async start(_task: NormalizedTask, context: AgentContext) {
        capturedContext = context;
        // Write 110 lines
        for (let i = 0; i < 110; i++) {
          context.reportProgress(`line ${i}`);
        }
      },
      async heartbeat() { return { alive: false, progress: "", percentComplete: null }; },
      async stop() {},
      kill() {},
    };

    const proc = await supervisor.spawn(agent, makeTask());
    await new Promise(r => setTimeout(r, 50));

    assert.ok(proc);
    const liveProc = supervisor.getProcess(proc.processId);
    assert.ok(liveProc);
    assert.equal(liveProc.output.length, 100);
    assert.equal(liveProc.output[0], "line 10"); // first 10 evicted
    assert.equal(liveProc.output[99], "line 109");
  });

  it("should force-kill an agent", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 3, retainWorkDirs: true });

    const events: unknown[] = [];
    supervisor.on("event", (e: unknown) => events.push(e));

    const agent = new FakeAgent();
    const proc = await supervisor.spawn(agent, makeTask());
    assert.ok(proc);

    const killed = await supervisor.killAgent(proc.processId, "test kill");
    assert.equal(killed, true);
    assert.ok(agent.killed);
    assert.ok(events.some(e => e instanceof AgentKilled));

    // Can't kill again
    const killedAgain = await supervisor.killAgent(proc.processId, "test kill");
    assert.equal(killedAgain, false);
  });

  it("should detect hung agents during checkAgents", async () => {
    supervisor = new AgentSupervisor({
      maxTotalAgents: 3,
      heartbeatTimeoutMs: 50, // very short for test
      cleanupIntervalMs: 100_000, // don't auto-run
      retainWorkDirs: true,
    });

    const events: unknown[] = [];
    supervisor.on("event", (e: unknown) => events.push(e));

    const agent = new FakeAgent();
    // Override heartbeat to return not alive
    agent.heartbeat = async () => ({ alive: false, progress: "", percentComplete: null });

    const proc = await supervisor.spawn(agent, makeTask());
    assert.ok(proc);

    // Wait for heartbeat to timeout
    await new Promise(r => setTimeout(r, 100));

    // Manually trigger check
    await (supervisor as unknown as { checkAgents: () => Promise<void> }).checkAgents();

    assert.ok(events.some(e => e instanceof AgentHung));
    assert.ok(events.some(e => e instanceof AgentKilled));
  });

  it("should list running and hung processes", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 5, retainWorkDirs: true });

    const a1 = new FakeAgent("a1", "fake");
    const a2 = new FakeAgent("a2", "fake");

    await supervisor.spawn(a1, makeTask({ taskId: "t1" }));
    await supervisor.spawn(a2, makeTask({ taskId: "t2" }));

    assert.equal(supervisor.getRunning().length, 2);
    assert.equal(supervisor.getHung().length, 0);
    assert.equal(supervisor.listProcesses().length, 2);

    a1.complete();
    a2.complete();
  });

  it("should gracefully shutdown running agents", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 3, retainWorkDirs: true });

    const agent = new FakeAgent();
    await supervisor.spawn(agent, makeTask());

    await supervisor.shutdown(500);
    assert.ok(agent.stopped);
  });

  it("should not spawn when shutting down", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 3, retainWorkDirs: true });

    // Start shutdown
    const shutdownPromise = supervisor.shutdown(100);

    const agent = new FakeAgent();
    const proc = await supervisor.spawn(agent, makeTask());
    assert.equal(proc, null);

    await shutdownPromise;
  });

  it("should handle reportHeartbeat from agent context", async () => {
    supervisor = new AgentSupervisor({ maxTotalAgents: 3, retainWorkDirs: true });

    let capturedContext: AgentContext | null = null;
    const agent: ManagedAgent = {
      name: "hb-test",
      type: "test",
      async start(_task: NormalizedTask, context: AgentContext) {
        capturedContext = context;
        context.reportHeartbeat();
        // Don't resolve - keep running
        return new Promise(() => {});
      },
      async heartbeat() { return { alive: true, progress: "", percentComplete: null }; },
      async stop() {},
      kill() {},
    };

    const proc = await supervisor.spawn(agent, makeTask());
    assert.ok(proc);
    assert.ok(capturedContext);

    // Heartbeat should have updated lastHeartbeatAt
    const liveProc = supervisor.getProcess(proc.processId);
    assert.ok(liveProc);
    assert.ok(liveProc.lastHeartbeatAt);
  });
});
