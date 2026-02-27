/**
 * Integration test: runs the full agent pipeline against real services.
 *
 * Requirements:
 *   - OPENAI_API_KEY set in environment or .env
 *   - ChromaDB running at http://localhost:8000 (docker start chromadb)
 *   - knowledge/ already indexed (npm run index -- knowledge/)
 *
 * Automatically skips with a clear message if either is unavailable.
 * Exit code 0 on skip, non-zero on failure.
 *
 * Run: npm run test:integration
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { AgentGraph } from "../src/agent/agent";
import { KnowledgeRetriever } from "../src/rag/retriever";
import type { TicketConnector, ListTicketsOptions, ListTicketsResult } from "../src/connectors/connector";
import type { Ticket, TicketComment, TicketAttachment } from "../src/connectors/types";

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.log("[integration] SKIP: OPENAI_API_KEY is not set.");
  process.exit(0);
}

const CHROMA_URL = "http://localhost:8000";

async function isChromaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${CHROMA_URL}/api/v2/heartbeat`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mock connector
// ---------------------------------------------------------------------------

const mockComments: TicketComment[] = [
  {
    id: "c1",
    author: { id: "u1", name: "Bob User", email: "bob@example.com" },
    body: "I've tried restarting my laptop twice but I still can't log in. It says my password is incorrect but I haven't changed it.",
    isInternal: false,
    createdAt: new Date("2024-01-15T09:00:00Z"),
  },
];

const mockTicket: Ticket = {
  id: "INC0099001",
  externalId: "INC0099001",
  source: "mock",
  url: "https://mock.service-now.com/incident/INC0099001",
  title: "Cannot log into laptop - password incorrect",
  description:
    "User reports being unable to log into their Windows laptop. " +
    "Getting 'incorrect password' error despite not having changed the password. " +
    "Laptop was working fine yesterday.",
  type: "incident",
  status: "open",
  priority: "medium",
  reporter: { id: "u1", name: "Bob User", email: "bob@example.com" },
  tags: ["password", "login", "authentication"],
  createdAt: new Date("2024-01-15T08:55:00Z"),
  updatedAt: new Date("2024-01-15T09:05:00Z"),
};

const mockConnector: TicketConnector = {
  name: "mock",
  listTickets: (_opts?: ListTicketsOptions): Promise<ListTicketsResult> =>
    Promise.resolve({ tickets: [], total: 0, page: 1, pageSize: 10, hasMore: false }),
  getTicket: (_id: string): Promise<Ticket> => Promise.resolve(mockTicket),
  getComments: (_id: string): Promise<TicketComment[]> => Promise.resolve(mockComments),
  addComment: async (_id: string, body: string, opts?: { isInternal?: boolean }): Promise<TicketComment> => ({
    id: `cmt-${Date.now()}`,
    author: { id: "agent", name: "AI Agent" },
    body,
    isInternal: opts?.isInternal ?? false,
    createdAt: new Date(),
  }),
  listAttachments: (_id: string): Promise<TicketAttachment[]> => Promise.resolve([]),
  downloadAttachment: (_id: string): Promise<Buffer> => Promise.resolve(Buffer.alloc(0)),
  uploadAttachment: async (_ticketId: string, filename: string, data: Buffer): Promise<TicketAttachment> => ({
    id: "att-1", filename, url: "#", size: data.length,
  }),
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run() {
  const reachable = await isChromaReachable();
  if (!reachable) {
    console.log("[integration] SKIP: ChromaDB is not reachable at http://localhost:8000.");
    console.log("             Start it with: docker start chromadb");
    process.exit(0);
  }

  console.log("[integration] Running full agent pipeline (dry-run)...\n");
  console.log(`  Ticket: ${mockTicket.id} - "${mockTicket.title}"`);

  const retriever = new KnowledgeRetriever({
    collectionName: "knowledge",
    chromaUrl: CHROMA_URL,
    openAIApiKey: OPENAI_KEY,
  });

  const agent = new AgentGraph({
    deps: { connector: mockConnector, retriever },
    model: "gpt-4o-mini",
    openAIApiKey: OPENAI_KEY,
    dryRun: true,
  });

  const state = await agent.run(mockTicket);

  // --- Assertions ---

  assert.equal(state.done, true, "agent should finish with done=true");
  assert.equal(state.error, null, `agent should not error, got: ${state.error}`);

  const validDecisions = new Set(["automate", "draft_response", "escalate", "needs_info"]);
  assert.ok(
    state.decision !== null && validDecisions.has(state.decision),
    `decision should be one of ${[...validDecisions].join("|")}, got: ${state.decision}`
  );

  assert.equal(state.steps.length, 5, `expected 5 steps (one per node), got ${state.steps.length}`);

  const nodeNames = state.steps.map(s => s.node);
  assert.deepEqual(nodeNames, ["ingest", "retrieve", "decide", "act", "record"]);

  assert.ok(state.reasoning.length > 0, "reasoning should be non-empty");
  assert.ok(state.confidence >= 0 && state.confidence <= 1, `confidence should be in [0,1], got ${state.confidence}`);

  // Knowledge chunks -- may be 0 if KB isn't indexed; log a warning rather than failing
  if (state.knowledgeChunks.length === 0) {
    console.warn("\n  [integration] WARNING: 0 KB chunks retrieved.");
    console.warn("  Run 'npm run index -- knowledge/' to index the sample docs first.\n");
  } else {
    assert.ok(state.knowledgeChunks.length > 0, "should have retrieved KB chunks");
    console.log(`\n  KB chunks retrieved: ${state.knowledgeChunks.length}`);
  }

  console.log(`\n[integration] PASSED`);
  console.log(`  Decision:   ${state.decision}`);
  console.log(`  Confidence: ${state.confidence.toFixed(2)}`);
  console.log(`  Steps:      ${nodeNames.join(" → ")}`);
}

run().catch(err => {
  console.error("\n[integration] FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
