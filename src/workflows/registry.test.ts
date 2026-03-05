import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { WorkflowRegistry } from "./registry";
import type { WorkflowExecutor, WorkflowDecision, Ticket, WorkflowContext, WorkflowResult } from "./types";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "INC0099001",
    title: "Test ticket",
    description: "Test description",
    source: "servicenow",
    fields: {},
    ...overrides,
  };
}

// Simple test executor
class TestExecutor implements WorkflowExecutor {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly description: string,
    private matchFn: (t: Ticket) => WorkflowDecision = () => "skip"
  ) {}

  canHandle(ticket: Ticket): WorkflowDecision {
    return this.matchFn(ticket);
  }

  async execute(_ticket: Ticket, _ctx: WorkflowContext): Promise<WorkflowResult> {
    return { success: true, decision: "execute", summary: "done", steps: [] };
  }
}

describe("WorkflowRegistry", () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = new WorkflowRegistry();
  });

  it("registers and retrieves executors", () => {
    const exec = new TestExecutor("test-1", "Test", "A test workflow");
    registry.register(exec);
    assert.equal(registry.get("test-1"), exec);
  });

  it("throws on duplicate registration", () => {
    registry.register(new TestExecutor("test-1", "Test", "desc"));
    assert.throws(() => registry.register(new TestExecutor("test-1", "Test", "desc")), /already registered/);
  });

  it("lists all registered executors", () => {
    registry.register(new TestExecutor("a", "A", ""));
    registry.register(new TestExecutor("b", "B", ""));
    registry.register(new TestExecutor("c", "C", ""));
    assert.equal(registry.list().length, 3);
  });

  it("returns undefined for unknown executor", () => {
    assert.equal(registry.get("nonexistent"), undefined);
  });
});

describe("WorkflowRegistry.match", () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = new WorkflowRegistry();
    registry.register(new TestExecutor("execute-match", "Exec", "desc", () => "execute"));
    registry.register(new TestExecutor("needs-info", "Info", "desc", () => "needs_info"));
    registry.register(new TestExecutor("skip-match", "Skip", "desc", () => "skip"));
  });

  it("returns executors that can handle the ticket", () => {
    const matches = registry.match(makeTicket());
    assert.equal(matches.length, 2); // execute + needs_info, skip excluded
  });

  it("sorts by confidence (execute > needs_info)", () => {
    const matches = registry.match(makeTicket());
    assert.equal(matches[0].executor.id, "execute-match");
    assert.equal(matches[0].confidence, 1.0);
    assert.equal(matches[1].executor.id, "needs-info");
    assert.equal(matches[1].confidence, 0.5);
  });

  it("findBest returns the top match", () => {
    const best = registry.findBest(makeTicket());
    assert.ok(best);
    assert.equal(best.executor.id, "execute-match");
  });

  it("findBest returns null when all skip", () => {
    const skipOnly = new WorkflowRegistry();
    skipOnly.register(new TestExecutor("skipper", "Skip", "desc", () => "skip"));
    assert.equal(skipOnly.findBest(makeTicket()), null);
  });
});

describe("WorkflowRegistry - conditional matching", () => {
  it("matches based on ticket content", () => {
    const registry = new WorkflowRegistry();
    registry.register(new TestExecutor(
      "bind-failure", "Bind", "desc",
      (t) => t.description.includes("Cannot access payment") ? "execute" : "skip"
    ));

    const bindTicket = makeTicket({ description: 'Error: Cannot access payment info for job "JobNumber": "1234567"' });
    const otherTicket = makeTicket({ description: "Password reset needed" });

    assert.equal(registry.findBest(bindTicket)?.executor.id, "bind-failure");
    assert.equal(registry.findBest(otherTicket), null);
  });

  it("matches based on ticket fields", () => {
    const registry = new WorkflowRegistry();
    registry.register(new TestExecutor(
      "with-attachment", "Att", "desc",
      (t) => t.fields.hasAttachment ? "execute" : "needs_info"
    ));

    const withAtt = makeTicket({ fields: { hasAttachment: true } });
    const withoutAtt = makeTicket({ fields: { hasAttachment: false } });

    assert.equal(registry.findBest(withAtt)?.decision, "execute");
    assert.equal(registry.findBest(withoutAtt)?.decision, "needs_info");
  });
});
