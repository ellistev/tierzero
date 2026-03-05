import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventStore } from "../infra/event-store";
import { ReadModelBuilder, ReadRepository } from "../infra/read-model";
import { ticketsReadModel } from "./tickets";

describe("Tickets Read Model", () => {
  let store: EventStore;
  let builder: ReadModelBuilder;
  let repo: ReadRepository;

  beforeEach(() => {
    store = new EventStore(":memory:");
    builder = new ReadModelBuilder(":memory:");
    repo = builder.register(ticketsReadModel);
    builder.subscribeTo(store);
  });

  it("should create ticket on TicketReceived", () => {
    store.appendToStream("Ticket-t1", [{ type: "TicketReceived", data: { id: "t1", title: "Test", description: "Desc", source: "sn", fields: {}, receivedAt: "2026-01-01" } }], 0);
    const ticket = repo.findOne("t1");
    assert.ok(ticket);
    assert.equal(ticket.title, "Test");
    assert.equal(ticket.status, "received");
  });

  it("should update on TicketAnalyzed", () => {
    store.appendToStream("Ticket-t1", [
      { type: "TicketReceived", data: { id: "t1", title: "T", description: "D", source: "sn", fields: {}, receivedAt: "2026-01-01" } },
      { type: "TicketAnalyzed", data: { ticketId: "t1", extractedFields: {}, analysisResult: "ok", analyzedAt: "2026-01-02" } },
    ], 0);
    assert.equal(repo.findOne("t1")!.status, "analyzed");
  });

  it("should update on TicketMatchedToWorkflow", () => {
    store.appendToStream("Ticket-t1", [
      { type: "TicketReceived", data: { id: "t1", title: "T", description: "D", source: "sn", fields: {}, receivedAt: "2026-01-01" } },
      { type: "TicketMatchedToWorkflow", data: { ticketId: "t1", workflowId: "wf-1", confidence: 0.95, matchedAt: "2026-01-02" } },
    ], 0);
    const t = repo.findOne("t1")!;
    assert.equal(t.status, "matched");
    assert.equal(t.workflowId, "wf-1");
    assert.equal(t.confidence, 0.95);
  });

  it("should update on TicketEscalated", () => {
    store.appendToStream("Ticket-t1", [
      { type: "TicketReceived", data: { id: "t1", title: "T", description: "D", source: "sn", fields: {}, receivedAt: "2026-01-01" } },
      { type: "TicketEscalated", data: { ticketId: "t1", reason: "Complex", escalatedAt: "2026-01-02" } },
    ], 0);
    assert.equal(repo.findOne("t1")!.status, "escalated");
  });

  it("should update on TicketResolved", () => {
    store.appendToStream("Ticket-t1", [
      { type: "TicketReceived", data: { id: "t1", title: "T", description: "D", source: "sn", fields: {}, receivedAt: "2026-01-01" } },
      { type: "TicketResolved", data: { ticketId: "t1", resolution: "Fixed", resolvedAt: "2026-01-02" } },
    ], 0);
    assert.equal(repo.findOne("t1")!.status, "resolved");
    assert.equal(repo.findOne("t1")!.resolution, "Fixed");
  });

  it("should list all tickets", () => {
    store.appendToStream("Ticket-t1", [{ type: "TicketReceived", data: { id: "t1", title: "A", description: "D", source: "sn", fields: {}, receivedAt: "2026-01-01" } }], 0);
    store.appendToStream("Ticket-t2", [{ type: "TicketReceived", data: { id: "t2", title: "B", description: "D", source: "jira", fields: {}, receivedAt: "2026-01-01" } }], 0);
    assert.equal(repo.findAll().length, 2);
  });

  it("should catch up from existing events", () => {
    store.appendToStream("Ticket-t1", [{ type: "TicketReceived", data: { id: "t1", title: "T", description: "D", source: "sn", fields: {}, receivedAt: "2026-01-01" } }], 0);
    const builder2 = new ReadModelBuilder(":memory:");
    const repo2 = builder2.register(ticketsReadModel);
    builder2.catchUp(store);
    assert.ok(repo2.findOne("t1"));
  });
});
