import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TicketPoller } from "./poller";
import type { PollerOptions } from "./poller";
import type { TicketConnector } from "../connectors/connector";
import type { Ticket } from "../connectors/types";
import type { AgentGraph, AgentState } from "./agent";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTicket(id: string, title = "Test ticket"): Ticket {
  return {
    id,
    source: "mock",
    title,
    description: "desc",
    type: "incident",
    status: "open",
    priority: "medium",
    reporter: { id: "u1", name: "Alice" },
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
}

const doneState: AgentState = {
  ticket: makeTicket("x"),
  comments: [],
  knowledgeChunks: [],
  knowledgeContext: "",
  decision: "automate",
  reasoning: "Found runbook",
  confidence: 0.9,
  draftedReply: "Here is the fix.",
  escalateTo: "",
  actionTaken: { type: "resolved", resolution: "Fixed." },
  iterationsUsed: 1,
  steps: [],
  done: true,
  error: null,
};

function makeConnector(tickets: Ticket[]): TicketConnector {
  return {
    name: "mock",
    listTickets: async () => ({ tickets, total: tickets.length, page: 1, pageSize: 50, hasMore: false }),
    getTicket: async (id) => tickets.find(t => t.id === id) ?? makeTicket(id),
    getComments: async () => [],
    addComment: async (_id, body, opts) => ({
      id: "cmt-1", author: { id: "agent", name: "AI" }, body,
      isInternal: opts?.isInternal ?? false, createdAt: new Date(),
    }),
    listAttachments: async () => [],
    downloadAttachment: async () => Buffer.alloc(0),
    uploadAttachment: async (_tid, filename, data) => ({ id: "a1", filename, url: "#", size: data.length }),
    updateTicket: async () => makeTicket("x"),
  };
}

function makeAgent(result: AgentState = doneState): AgentGraph {
  return { run: async () => result } as unknown as AgentGraph;
}

function makePoller(overrides: Partial<PollerOptions> = {}, tickets: Ticket[] = []): TicketPoller {
  return new TicketPoller({
    connector: makeConnector(tickets),
    agent: makeAgent(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// poll() — basic behaviour
// ---------------------------------------------------------------------------

describe("TicketPoller.poll() — basic", () => {
  test("returns zero counts when no open tickets exist", async () => {
    const poller = makePoller({}, []);
    const result = await poller.poll();
    assert.equal(result.ticketsFound, 0);
    assert.equal(result.ticketsProcessed, 0);
    assert.deepEqual(result.errors, []);
  });

  test("processes fresh tickets and returns correct counts", async () => {
    const tickets = [makeTicket("T1"), makeTicket("T2"), makeTicket("T3")];
    const poller = makePoller({}, tickets);
    const result = await poller.poll();
    assert.equal(result.ticketsFound, 3);
    assert.equal(result.ticketsProcessed, 3);
    assert.equal(result.errors.length, 0);
  });

  test("adds processed ticket IDs to the processed set", async () => {
    const tickets = [makeTicket("A"), makeTicket("B")];
    const poller = makePoller({}, tickets);
    await poller.poll();
    assert.ok(poller.processed.has("A"));
    assert.ok(poller.processed.has("B"));
  });
});

// ---------------------------------------------------------------------------
// poll() — deduplication
// ---------------------------------------------------------------------------

describe("TicketPoller.poll() — deduplication", () => {
  test("skips tickets already in processedIds", async () => {
    const processedIds = new Set(["T1", "T2"]);
    const tickets = [makeTicket("T1"), makeTicket("T2"), makeTicket("T3")];
    const poller = makePoller({ processedIds }, tickets);
    const result = await poller.poll();
    assert.equal(result.ticketsFound, 1); // only T3 is fresh
    assert.equal(result.ticketsProcessed, 1);
  });

  test("running poll twice does not re-process the same tickets", async () => {
    const tickets = [makeTicket("T1"), makeTicket("T2")];
    let runCount = 0;
    const poller = makePoller({
      connector: makeConnector(tickets),
      agent: { run: async () => { runCount++; return doneState; } } as unknown as AgentGraph,
    });
    await poller.poll();
    await poller.poll();
    assert.equal(runCount, 2); // processed once each, not four times
  });

  test("marks ticket as processed before running agent (re-entry guard)", async () => {
    let processedDuringRun = false;
    const ticket = makeTicket("T1");
    const processedIds = new Set<string>();
    const poller = makePoller({
      connector: makeConnector([ticket]),
      processedIds,
      agent: {
        run: async () => {
          // By the time agent runs, T1 should already be in the set
          processedDuringRun = processedIds.has("T1");
          return doneState;
        },
      } as unknown as AgentGraph,
    });
    await poller.poll();
    assert.equal(processedDuringRun, true);
  });
});

// ---------------------------------------------------------------------------
// poll() — batchSize
// ---------------------------------------------------------------------------

describe("TicketPoller.poll() — batchSize", () => {
  test("respects batchSize cap per cycle", async () => {
    const tickets = [makeTicket("T1"), makeTicket("T2"), makeTicket("T3"), makeTicket("T4"), makeTicket("T5")];
    const poller = makePoller({ batchSize: 2 }, tickets);
    const result = await poller.poll();
    assert.equal(result.ticketsProcessed, 2);
    assert.equal(poller.processed.size, 2);
  });

  test("batchSize=0 means unlimited", async () => {
    const tickets = Array.from({ length: 10 }, (_, i) => makeTicket(`T${i}`));
    const poller = makePoller({ batchSize: 0 }, tickets);
    const result = await poller.poll();
    assert.equal(result.ticketsProcessed, 10);
  });

  test("second cycle after batching picks up remaining tickets", async () => {
    const tickets = [makeTicket("T1"), makeTicket("T2"), makeTicket("T3")];
    const poller = makePoller({ connector: makeConnector(tickets), batchSize: 2 });
    await poller.poll(); // processes T1, T2
    const result2 = await poller.poll(); // processes T3
    assert.equal(result2.ticketsProcessed, 1);
  });
});

// ---------------------------------------------------------------------------
// poll() — error handling
// ---------------------------------------------------------------------------

describe("TicketPoller.poll() — error handling", () => {
  test("agent errors are captured without throwing from poll()", async () => {
    const ticket = makeTicket("T1");
    const poller = makePoller({
      connector: makeConnector([ticket]),
      agent: { run: async () => { throw new Error("LLM timeout"); } } as unknown as AgentGraph,
    });
    const result = await poller.poll();
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].ticketId, "T1");
    assert.ok(result.errors[0].error.includes("LLM timeout"));
    assert.equal(result.ticketsProcessed, 0);
  });

  test("an errored ticket stays in processedIds (not re-queued)", async () => {
    const ticket = makeTicket("T1");
    const poller = makePoller({
      connector: makeConnector([ticket]),
      agent: { run: async () => { throw new Error("fail"); } } as unknown as AgentGraph,
    });
    await poller.poll();
    assert.ok(poller.processed.has("T1"));
  });

  test("one ticket error does not stop processing the rest of the batch", async () => {
    const tickets = [makeTicket("T1"), makeTicket("T2"), makeTicket("T3")];
    let runCount = 0;
    const poller = makePoller({
      connector: makeConnector(tickets),
      agent: {
        run: async (ticket: Ticket) => {
          runCount++;
          if (ticket.id === "T2") throw new Error("T2 exploded");
          return doneState;
        },
      } as unknown as AgentGraph,
    });
    const result = await poller.poll();
    assert.equal(runCount, 3);
    assert.equal(result.ticketsProcessed, 2);
    assert.equal(result.errors.length, 1);
  });

  test("connector listTickets error bubbles out of poll()", async () => {
    const poller = makePoller({
      connector: {
        ...makeConnector([]),
        listTickets: async () => { throw new Error("network down"); },
      },
    });
    await assert.rejects(() => poller.poll(), /network down/);
  });
});

// ---------------------------------------------------------------------------
// poll() — callbacks
// ---------------------------------------------------------------------------

describe("TicketPoller.poll() — callbacks", () => {
  test("onTicketStart is called for each ticket before agent runs", async () => {
    const started: string[] = [];
    const tickets = [makeTicket("T1"), makeTicket("T2")];
    const poller = makePoller({
      connector: makeConnector(tickets),
      onTicketStart: (t) => started.push(t.id),
    });
    await poller.poll();
    assert.deepEqual(started, ["T1", "T2"]);
  });

  test("onTicketDone is called with ticket and final AgentState", async () => {
    const done: Array<{ id: string; decision: string | null }> = [];
    const poller = makePoller({
      connector: makeConnector([makeTicket("T1")]),
      onTicketDone: (t, state) => done.push({ id: t.id, decision: state.decision }),
    });
    await poller.poll();
    assert.deepEqual(done, [{ id: "T1", decision: "automate" }]);
  });

  test("onTicketError is called with ticket and error when agent throws", async () => {
    const errors: Array<{ id: string; err: unknown }> = [];
    const poller = makePoller({
      connector: makeConnector([makeTicket("T1")]),
      agent: { run: async () => { throw new Error("boom"); } } as unknown as AgentGraph,
      onTicketError: (t, err) => errors.push({ id: t.id, err }),
    });
    await poller.poll();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].id, "T1");
    assert.ok(errors[0].err instanceof Error);
  });

  test("onCycleDone is called once per poll() with a PollResult", async () => {
    const cycles: number[] = [];
    const poller = makePoller({
      connector: makeConnector([makeTicket("T1"), makeTicket("T2")]),
      onCycleDone: (r) => cycles.push(r.ticketsProcessed),
    });
    await poller.poll();
    await poller.poll(); // second cycle: no fresh tickets
    assert.deepEqual(cycles, [2, 0]);
  });
});

// ---------------------------------------------------------------------------
// stop() / isRunning
// ---------------------------------------------------------------------------

describe("TicketPoller stop/isRunning", () => {
  test("isRunning is false before start()", () => {
    const poller = makePoller();
    assert.equal(poller.isRunning, false);
  });

  test("isRunning is true after start() and false after stop()", () => {
    const poller = makePoller();
    const stop = poller.start(60_000); // long interval so poll() doesn't actually fire
    assert.equal(poller.isRunning, true);
    stop();
    assert.equal(poller.isRunning, false);
  });

  test("stop() is idempotent — calling twice does not throw", () => {
    const poller = makePoller();
    poller.start(60_000);
    poller.stop();
    assert.doesNotThrow(() => poller.stop());
  });
});

// ---------------------------------------------------------------------------
// processedIds injection
// ---------------------------------------------------------------------------

describe("TicketPoller processedIds injection", () => {
  test("accepts a pre-seeded processedIds set", async () => {
    const processedIds = new Set(["T1", "T2"]);
    const tickets = [makeTicket("T1"), makeTicket("T3")];
    const poller = makePoller({ processedIds }, tickets);
    const result = await poller.poll();
    assert.equal(result.ticketsProcessed, 1); // only T3
  });

  test("poller.processed is the same reference as the injected set", () => {
    const processedIds = new Set<string>();
    const poller = makePoller({ processedIds });
    assert.equal(poller.processed, processedIds);
  });
});
