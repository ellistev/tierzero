import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ticket } from "./Ticket";
import { ReceiveTicket, AnalyzeTicket, MatchToWorkflow, EscalateTicket, ResolveTicket, PostComment } from "./commands";
import { TicketReceived, TicketAnalyzed, TicketMatchedToWorkflow, TicketEscalated, TicketResolved, TicketCommentPosted } from "./events";

const now = "2026-01-01T00:00:00.000Z";

describe("Ticket Aggregate", () => {
  it("should receive a ticket", () => {
    const agg = new Ticket();
    const events = agg.execute(new ReceiveTicket("t1", "Title", "Desc", "servicenow", { priority: "high" }, now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof TicketReceived);
    const e = events![0] as TicketReceived;
    assert.equal(e.id, "t1");
    assert.equal(e.title, "Title");
    assert.equal(e.source, "servicenow");
  });

  it("should analyze a received ticket", () => {
    const agg = new Ticket();
    agg.hydrate(new TicketReceived("t1", "Title", "Desc", "sn", {}, now));
    const events = agg.execute(new AnalyzeTicket("t1", { ci: "server01" }, "needs reboot", now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof TicketAnalyzed);
  });

  it("should match to workflow", () => {
    const agg = new Ticket();
    agg.hydrate(new TicketReceived("t1", "Title", "Desc", "sn", {}, now));
    agg.hydrate(new TicketAnalyzed("t1", {}, "ok", now));
    const events = agg.execute(new MatchToWorkflow("t1", "wf-reboot", 0.95, now));
    assert.equal(events!.length, 1);
    assert.ok(events![0] instanceof TicketMatchedToWorkflow);
  });

  it("should escalate a ticket", () => {
    const agg = new Ticket();
    agg.hydrate(new TicketReceived("t1", "Title", "Desc", "sn", {}, now));
    const events = agg.execute(new EscalateTicket("t1", "Out of scope", now));
    assert.ok(events![0] instanceof TicketEscalated);
  });

  it("should resolve a ticket", () => {
    const agg = new Ticket();
    agg.hydrate(new TicketReceived("t1", "Title", "Desc", "sn", {}, now));
    const events = agg.execute(new ResolveTicket("t1", "Rebooted server", now));
    assert.ok(events![0] instanceof TicketResolved);
  });

  it("should post a comment", () => {
    const agg = new Ticket();
    agg.hydrate(new TicketReceived("t1", "Title", "Desc", "sn", {}, now));
    const events = agg.execute(new PostComment("t1", "Working on it", true, now));
    assert.ok(events![0] instanceof TicketCommentPosted);
    assert.equal((events![0] as TicketCommentPosted).isInternal, true);
  });

  it("should reject commands on non-existent ticket", () => {
    const agg = new Ticket();
    assert.throws(() => agg.execute(new AnalyzeTicket("t1", {}, "ok", now)), /does not exist/);
    assert.throws(() => agg.execute(new ResolveTicket("t1", "done", now)), /does not exist/);
    assert.throws(() => agg.execute(new EscalateTicket("t1", "reason", now)), /does not exist/);
    assert.throws(() => agg.execute(new PostComment("t1", "hey", false, now)), /does not exist/);
  });

  it("should reject commands on resolved ticket", () => {
    const agg = new Ticket();
    agg.hydrate(new TicketReceived("t1", "Title", "Desc", "sn", {}, now));
    agg.hydrate(new TicketResolved("t1", "done", now));
    assert.throws(() => agg.execute(new AnalyzeTicket("t1", {}, "ok", now)), /resolved/);
    assert.throws(() => agg.execute(new MatchToWorkflow("t1", "wf", 0.9, now)), /resolved/);
    assert.throws(() => agg.execute(new EscalateTicket("t1", "reason", now)), /resolved/);
    assert.throws(() => agg.execute(new ResolveTicket("t1", "again", now)), /resolved/);
  });

  it("should allow posting comments on resolved tickets", () => {
    const agg = new Ticket();
    agg.hydrate(new TicketReceived("t1", "Title", "Desc", "sn", {}, now));
    agg.hydrate(new TicketResolved("t1", "done", now));
    const events = agg.execute(new PostComment("t1", "Follow-up", false, now));
    assert.equal(events!.length, 1);
  });

  it("should build correct state through full lifecycle", () => {
    const agg = new Ticket();
    agg.hydrate(new TicketReceived("t1", "Title", "Desc", "sn", { p: 1 }, now));
    agg.hydrate(new TicketAnalyzed("t1", { ci: "srv" }, "ok", now));
    agg.hydrate(new TicketMatchedToWorkflow("t1", "wf-1", 0.9, now));
    agg.hydrate(new TicketCommentPosted("t1", "Working", true, now));
    agg.hydrate(new TicketResolved("t1", "Fixed", now));
    const state = agg.createMemento().state;
    assert.equal(state.status, "resolved");
    assert.equal(state.workflowId, "wf-1");
    assert.equal(state.resolution, "Fixed");
    assert.equal((state.comments as unknown[]).length, 1);
    assert.equal(state.fields.ci, "srv");
  });
});
