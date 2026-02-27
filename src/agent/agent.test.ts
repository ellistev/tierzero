import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  TOOLS,
  _applyConfidenceThreshold,
} from "./agent";
import type { AgentDeps } from "./agent";
import type { Ticket } from "../connectors/types";
import type { TicketComment } from "../connectors/types";
import type { TicketConnector } from "../connectors/connector";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockTicket: Ticket = {
  id: "T001",
  source: "mock",
  title: "Test ticket",
  description: "Something is broken",
  type: "incident",
  status: "open",
  priority: "medium",
  reporter: { id: "u1", name: "Alice" },
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

function makeMockConnector(overrides: Partial<TicketConnector> = {}): TicketConnector {
  return {
    name: "mock",
    listTickets: async () => ({ tickets: [], total: 0, page: 1, pageSize: 10, hasMore: false }),
    getTicket: async () => mockTicket,
    getComments: async () => [],
    addComment: async (_id, body, opts) => ({
      id: `cmt-${Date.now()}`,
      author: { id: "agent", name: "AI Agent" },
      body,
      isInternal: opts?.isInternal ?? false,
      createdAt: new Date(),
    }),
    listAttachments: async () => [],
    downloadAttachment: async () => Buffer.alloc(0),
    uploadAttachment: async (_ticketId, filename, data) => ({
      id: "att-1", filename, url: "#", size: data.length,
    }),
    ...overrides,
  };
}

const mockSearchResult = {
  query: "test query",
  chunks: [{ content: "fix: do X", score: 0.9, source: "runbooks/x.md", metadata: {} as any }],
  totalFound: 1,
  totalReturned: 1,
};

const mockRetriever: AgentDeps["retriever"] = {
  search: async () => mockSearchResult,
  searchByType: async () => mockSearchResult,
  searchByFolder: async () => mockSearchResult,
} as any;

function makeDeps(overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    connector: makeMockConnector(),
    retriever: mockRetriever,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// initialState
// ---------------------------------------------------------------------------

describe("initialState", () => {
  test("sets ticket and initialises all fields to empty/null defaults", () => {
    const state = initialState(mockTicket);
    assert.equal(state.ticket, mockTicket);
    assert.deepEqual(state.comments, []);
    assert.deepEqual(state.knowledgeChunks, []);
    assert.equal(state.knowledgeContext, "");
    assert.equal(state.decision, null);
    assert.equal(state.reasoning, "");
    assert.equal(state.confidence, 0);
    assert.equal(state.draftedReply, "");
    assert.equal(state.actionTaken, null);
    assert.equal(state.iterationsUsed, 0);
    assert.deepEqual(state.steps, []);
    assert.equal(state.done, false);
    assert.equal(state.error, null);
  });
});

// ---------------------------------------------------------------------------
// _applyConfidenceThreshold
// ---------------------------------------------------------------------------

describe("_applyConfidenceThreshold", () => {
  test("does not override when confidence meets threshold", () => {
    const result = _applyConfidenceThreshold("automate", 0.8, "good reasoning", 0.4);
    assert.equal(result.decision, "automate");
    assert.equal(result.reasoning, "good reasoning");
  });

  test("does not override when confidence equals threshold", () => {
    const result = _applyConfidenceThreshold("draft_response", 0.4, "reasoning", 0.4);
    assert.equal(result.decision, "draft_response");
  });

  test("overrides to escalate when confidence is below threshold", () => {
    const result = _applyConfidenceThreshold("automate", 0.2, "reasoning", 0.4);
    assert.equal(result.decision, "escalate");
  });

  test("does not double-override when decision is already escalate", () => {
    const result = _applyConfidenceThreshold("escalate", 0.1, "reasoning", 0.4);
    assert.equal(result.decision, "escalate");
    // reasoning should NOT get the override note appended
    assert.ok(!result.reasoning.includes("overriding to escalate"));
  });

  test("appends override note to reasoning when overriding", () => {
    const result = _applyConfidenceThreshold("automate", 0.2, "original reasoning", 0.4);
    assert.ok(result.reasoning.includes("original reasoning"));
    assert.ok(result.reasoning.includes("overriding to escalate"));
    assert.ok(result.reasoning.includes("0.20"));
  });

  test("all four decision types can be overridden (except escalate)", () => {
    const decisions = ["automate", "draft_response", "needs_info"] as const;
    for (const d of decisions) {
      const r = _applyConfidenceThreshold(d, 0.1, "r", 0.4);
      assert.equal(r.decision, "escalate", `${d} should be overridden`);
    }
  });
});

// ---------------------------------------------------------------------------
// TOOLS.readComments
// ---------------------------------------------------------------------------

describe("TOOLS.readComments", () => {
  test("fetches comments from the connector", async () => {
    const comments: TicketComment[] = [
      { id: "c1", author: { id: "u1", name: "Bob" }, body: "hi", isInternal: false, createdAt: new Date() },
    ];
    const deps = makeDeps({
      connector: makeMockConnector({ getComments: async () => comments }),
    });
    const out = await TOOLS.readComments.execute({ ticketId: "T001" }, deps);
    assert.equal(out.count, 1);
    assert.equal(out.comments, comments);
  });

  test("returns count 0 when no comments", async () => {
    const out = await TOOLS.readComments.execute({ ticketId: "T001" }, makeDeps());
    assert.equal(out.count, 0);
    assert.deepEqual(out.comments, []);
  });
});

// ---------------------------------------------------------------------------
// TOOLS.postPublicComment
// ---------------------------------------------------------------------------

describe("TOOLS.postPublicComment", () => {
  test("calls connector.addComment with isInternal false", async () => {
    let capturedOpts: { isInternal?: boolean } | undefined;
    const deps = makeDeps({
      connector: makeMockConnector({
        addComment: async (_id, _body, opts) => {
          capturedOpts = opts;
          return { id: "cmt-1", author: { id: "agent", name: "AI" }, body: _body, isInternal: false, createdAt: new Date() };
        },
      }),
    });
    const out = await TOOLS.postPublicComment.execute({ ticketId: "T001", body: "hello reporter" }, deps);
    assert.equal(capturedOpts?.isInternal, false);
    assert.equal(out.commentId, "cmt-1");
  });
});

// ---------------------------------------------------------------------------
// TOOLS.postInternalNote
// ---------------------------------------------------------------------------

describe("TOOLS.postInternalNote", () => {
  test("calls connector.addComment with isInternal true", async () => {
    let capturedOpts: { isInternal?: boolean } | undefined;
    const deps = makeDeps({
      connector: makeMockConnector({
        addComment: async (_id, _body, opts) => {
          capturedOpts = opts;
          return { id: "note-1", author: { id: "agent", name: "AI" }, body: _body, isInternal: true, createdAt: new Date() };
        },
      }),
    });
    await TOOLS.postInternalNote.execute({ ticketId: "T001", body: "internal note" }, deps);
    assert.equal(capturedOpts?.isInternal, true);
  });
});

// ---------------------------------------------------------------------------
// TOOLS.escalate
// ---------------------------------------------------------------------------

describe("TOOLS.escalate", () => {
  test("posts an internal note and returns success", async () => {
    let noteBody = "";
    const deps = makeDeps({
      connector: makeMockConnector({
        addComment: async (_id, body, _opts) => {
          noteBody = body;
          return { id: "note-2", author: { id: "a", name: "A" }, body, isInternal: true, createdAt: new Date() };
        },
      }),
    });
    const out = await TOOLS.escalate.execute(
      { ticketId: "T001", assigneeId: "team-net", reason: "needs physical access" },
      deps
    );
    assert.equal(out.success, true);
    assert.ok(noteBody.includes("needs physical access"), "reason should appear in internal note");
  });
});

// ---------------------------------------------------------------------------
// TOOLS.resolve
// ---------------------------------------------------------------------------

describe("TOOLS.resolve", () => {
  test("posts public comment with resolution text and returns commentId", async () => {
    const out = await TOOLS.resolve.execute(
      { ticketId: "T001", resolution: "Fixed by restarting service X." },
      makeDeps()
    );
    assert.equal(typeof out.commentId, "string");
    assert.equal(out.success, true);
  });
});

// ---------------------------------------------------------------------------
// TOOLS.requestInfo
// ---------------------------------------------------------------------------

describe("TOOLS.requestInfo", () => {
  test("posts public comment with the question and returns commentId", async () => {
    let capturedBody = "";
    const deps = makeDeps({
      connector: makeMockConnector({
        addComment: async (_id, body, _opts) => {
          capturedBody = body;
          return { id: "cmt-q", author: { id: "a", name: "A" }, body, isInternal: false, createdAt: new Date() };
        },
      }),
    });
    const out = await TOOLS.requestInfo.execute(
      { ticketId: "T001", question: "What OS version are you running?" },
      deps
    );
    assert.equal(capturedBody, "What OS version are you running?");
    assert.equal(out.commentId, "cmt-q");
  });
});

// ---------------------------------------------------------------------------
// TOOLS.searchKnowledge
// ---------------------------------------------------------------------------

describe("TOOLS.searchKnowledge", () => {
  test("returns chunks and formatted context from retriever", async () => {
    const out = await TOOLS.searchKnowledge.execute(
      { query: "how to fix VPN" },
      makeDeps()
    );
    assert.equal(out.found, 1);
    assert.equal(out.chunks.length, 1);
    assert.equal(typeof out.context, "string");
    assert.ok(out.context.length > 0, "context should be non-empty");
  });

  test("passes folder filter to retriever when provided", async () => {
    let capturedFilter: unknown;
    const deps = makeDeps({
      retriever: {
        search: async (_query: string, opts?: Record<string, unknown>) => {
          capturedFilter = opts?.["filter"];
          return mockSearchResult;
        },
        searchByType: async () => mockSearchResult,
        searchByFolder: async () => mockSearchResult,
      } as any,
    });
    await TOOLS.searchKnowledge.execute({ query: "q", folder: "runbooks/" }, deps);
    assert.ok(
      capturedFilter !== undefined,
      "filter should be passed to retriever when folder is specified"
    );
  });

  test("passes no filter when folder is not specified", async () => {
    let capturedFilter: unknown = "not-checked";
    const deps = makeDeps({
      retriever: {
        search: async (_query: string, opts?: Record<string, unknown>) => {
          capturedFilter = opts?.["filter"];
          return mockSearchResult;
        },
        searchByType: async () => mockSearchResult,
        searchByFolder: async () => mockSearchResult,
      } as any,
    });
    await TOOLS.searchKnowledge.execute({ query: "q" }, deps);
    assert.equal(capturedFilter, undefined);
  });
});
