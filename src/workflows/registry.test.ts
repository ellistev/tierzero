import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { WorkflowRegistry } from "./registry";
import { RequoteRebindExecutor } from "./executors/requote-rebind";
import { PlateLookupExecutor } from "./executors/plate-lookup";
import { QueryHelperExecutor } from "./executors/query-helper";
import type { ScrapedTicketDetail } from "../browser/servicenow-scraper";

function makeTicket(overrides: Partial<ScrapedTicketDetail> = {}): ScrapedTicketDetail {
  return {
    incNumber: "INC0099001",
    sysId: "abc123",
    shortDesc: "Test ticket",
    description: "Test description",
    hasGwError: false,
    oldJobNumber: null,
    attachmentSysId: null,
    attachmentName: null,
    alreadyFixed: false,
    ...overrides,
  };
}

describe("WorkflowRegistry", () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = new WorkflowRegistry();
  });

  it("registers and retrieves executors", () => {
    const rebind = new RequoteRebindExecutor();
    registry.register(rebind);
    assert.equal(registry.get("requote-rebind"), rebind);
  });

  it("throws on duplicate registration", () => {
    registry.register(new RequoteRebindExecutor());
    assert.throws(() => registry.register(new RequoteRebindExecutor()), /already registered/);
  });

  it("lists all registered executors", () => {
    registry.register(new RequoteRebindExecutor());
    registry.register(new PlateLookupExecutor());
    registry.register(new QueryHelperExecutor());
    assert.equal(registry.list().length, 3);
  });

  it("returns undefined for unknown executor", () => {
    assert.equal(registry.get("nonexistent"), undefined);
  });
});

describe("RequoteRebindExecutor.canHandle", () => {
  const executor = new RequoteRebindExecutor();

  it("returns execute for standard bind failure ticket", () => {
    const ticket = makeTicket({
      hasGwError: true,
      oldJobNumber: "7654321",
      attachmentSysId: "att-001",
    });
    assert.equal(executor.canHandle(ticket), "execute");
  });

  it("returns skip for already fixed tickets", () => {
    const ticket = makeTicket({ alreadyFixed: true, hasGwError: true });
    assert.equal(executor.canHandle(ticket), "skip");
  });

  it("returns skip for non-GW-error tickets", () => {
    const ticket = makeTicket({ hasGwError: false });
    assert.equal(executor.canHandle(ticket), "skip");
  });

  it("returns needs_info when no job number", () => {
    const ticket = makeTicket({ hasGwError: true, oldJobNumber: null });
    assert.equal(executor.canHandle(ticket), "needs_info");
  });
});

describe("PlateLookupExecutor.canHandle", () => {
  const executor = new PlateLookupExecutor();

  it("returns execute for plate lookup requests with job number", () => {
    const ticket = makeTicket({
      shortDesc: "Find plate number",
      description: "Please look up the plate for job 1234567",
    });
    assert.equal(executor.canHandle(ticket), "execute");
  });

  it("returns skip for unrelated tickets", () => {
    const ticket = makeTicket({ description: "Password reset needed" });
    assert.equal(executor.canHandle(ticket), "skip");
  });

  it("returns needs_info for plate request without job number", () => {
    const ticket = makeTicket({
      shortDesc: "Find plate number",
      description: "What is the plate for the customer's vehicle?",
    });
    assert.equal(executor.canHandle(ticket), "needs_info");
  });
});

describe("QueryHelperExecutor.canHandle", () => {
  const executor = new QueryHelperExecutor();

  it("returns execute for transaction lookup requests", () => {
    const ticket = makeTicket({
      description: "Please look up the transaction ID for job 9876543",
    });
    assert.equal(executor.canHandle(ticket), "execute");
  });

  it("returns skip for unrelated tickets", () => {
    const ticket = makeTicket({ description: "VPN not working" });
    assert.equal(executor.canHandle(ticket), "skip");
  });
});

describe("WorkflowRegistry.match", () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = new WorkflowRegistry();
    registry.register(new RequoteRebindExecutor());
    registry.register(new PlateLookupExecutor());
    registry.register(new QueryHelperExecutor());
  });

  it("matches bind failure to requote-rebind", () => {
    const ticket = makeTicket({
      hasGwError: true,
      oldJobNumber: "7654321",
    });
    const matches = registry.match(ticket);
    assert.ok(matches.length > 0);
    assert.equal(matches[0].executor.id, "requote-rebind");
    assert.equal(matches[0].decision, "execute");
  });

  it("returns empty for unmatched tickets", () => {
    const ticket = makeTicket({ description: "My monitor is flickering" });
    const matches = registry.match(ticket);
    assert.equal(matches.length, 0);
  });

  it("findBest returns the top match", () => {
    const ticket = makeTicket({
      hasGwError: true,
      oldJobNumber: "7654321",
    });
    const best = registry.findBest(ticket);
    assert.ok(best);
    assert.equal(best.executor.id, "requote-rebind");
  });

  it("findBest returns null for no match", () => {
    const ticket = makeTicket({ description: "Printer jam" });
    assert.equal(registry.findBest(ticket), null);
  });
});
