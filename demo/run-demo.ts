#!/usr/bin/env tsx
/**
 * TierZero Demo Runner
 * 
 * Runs the full pipeline:
 * 1. Starts mock ServiceNow server
 * 2. Checks ChromaDB is running
 * 3. Indexes the knowledge base
 * 4. Runs the agent against each ticket
 * 5. Shows results
 */

import "dotenv/config";
import { startMockServer } from "./mock-servicenow";
import { KnowledgeIndexer } from "../src/rag/indexer";
import { KnowledgeRetriever } from "../src/rag/retriever";
import { ServiceNowConnector } from "../src/connectors/servicenow";
import { AgentGraph } from "../src/agent/agent";
import path from "path";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY;
const c = {
  bold:    (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  dim:     (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  green:   (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:     (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow:  (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:    (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  magenta: (s: string) => isTTY ? `\x1b[35m${s}\x1b[0m` : s,
  bgGreen: (s: string) => isTTY ? `\x1b[42m\x1b[30m${s}\x1b[0m` : s,
  bgRed:   (s: string) => isTTY ? `\x1b[41m\x1b[37m${s}\x1b[0m` : s,
  bgYellow:(s: string) => isTTY ? `\x1b[43m\x1b[30m${s}\x1b[0m` : s,
  bgCyan:  (s: string) => isTTY ? `\x1b[46m\x1b[30m${s}\x1b[0m` : s,
};

function hr(char = "─") { console.log(c.dim(char.repeat(80))); }
function banner(text: string) {
  console.log("\n" + c.bold(c.cyan("╔" + "═".repeat(78) + "╗")));
  console.log(c.bold(c.cyan("║")) + " " + c.bold(text.padEnd(77)) + c.bold(c.cyan("║")));
  console.log(c.bold(c.cyan("╚" + "═".repeat(78) + "╝")) + "\n");
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const model = process.argv.includes("--model")
    ? process.argv[process.argv.indexOf("--model") + 1]
    : "gpt-4o-mini";
  const skipIndex = process.argv.includes("--skip-index");

  banner("TierZero Demo - AI Ticket Resolution Agent");

  console.log(`  ${c.bold("Mode:")}     ${dryRun ? c.yellow("DRY RUN (no actions taken)") : c.green("LIVE (agent will post comments)")}`);
  console.log(`  ${c.bold("Model:")}    ${c.cyan(model)}`);
  console.log(`  ${c.bold("RAG:")}      ChromaDB + OpenAI embeddings`);
  console.log(`  ${c.bold("Tickets:")} Mock ServiceNow on localhost:8888`);
  console.log();

  // ── Step 1: Start mock ServiceNow ────────────────────────────────────
  banner("Step 1: Starting Mock ServiceNow Server");
  const server = await startMockServer(8888);

  // ── Step 2: Check ChromaDB ───────────────────────────────────────────
  banner("Step 2: Checking ChromaDB");
  try {
    // Try v2 first (ChromaDB >= 1.x), fall back to v1
    let chromaRes = await fetch("http://localhost:8000/api/v2/heartbeat").catch(() => null);
    if (!chromaRes || !chromaRes.ok) {
      chromaRes = await fetch("http://localhost:8000/api/v1/heartbeat").catch(() => null);
    }
    if (!chromaRes || !chromaRes.ok) throw new Error("ChromaDB not responding");
    console.log(`  ${c.green("✓")} ChromaDB is running on localhost:8000`);
  } catch (err) {
    console.log(`  ${c.red("✗")} ChromaDB is not running!`);
    console.log(`  ${c.dim("Start it with:")} docker run -d -p 8000:8000 chromadb/chroma`);
    server.close();
    process.exit(1);
  }

  // ── Step 3: Index knowledge base ─────────────────────────────────────
  banner("Step 3: Indexing Knowledge Base");
  const knowledgeDir = path.resolve(__dirname, "..", "knowledge");

  if (skipIndex) {
    console.log(`  ${c.yellow("⏭")} Skipping indexing (--skip-index)`);
  } else {
    console.log(`  ${c.dim("Source:")} ${knowledgeDir}`);

    const indexer = new KnowledgeIndexer({
      knowledgeDir,
      collectionName: "tierzero-demo",
      chromaUrl: "http://localhost:8000",
      chunkSize: 800,
      chunkOverlap: 150,
    });

    const result = await indexer.index({ force: true });
    console.log(`  ${c.green("✓")} Indexed ${result.filesProcessed} files, ${result.chunksAdded} chunks`);
    if (result.errors.length > 0) {
      result.errors.forEach(e => console.log(`    ${c.red("!")} ${e.file}: ${e.error}`));
    }
  }

  // ── Step 4: Set up connector + retriever ─────────────────────────────
  const connector = new ServiceNowConnector({
    instanceUrl: "http://localhost:8888",
    username: "demo",
    password: "demo",
    table: "incident",
  });

  const retriever = new KnowledgeRetriever({
    collectionName: "tierzero-demo",
    chromaUrl: "http://localhost:8000",
    k: 5,
    scoreThreshold: 0.3,
  });

  const agent = new AgentGraph({
    deps: { connector, retriever },
    model,
    maxIterations: 10,
    minConfidence: 0.4,
    dryRun,
  });

  // ── Step 5: List and process tickets ─────────────────────────────────
  banner("Step 4: Fetching Tickets from ServiceNow");
  const { tickets, total } = await connector.listTickets({ status: "open" });
  console.log(`  ${c.green("✓")} Found ${total} open tickets\n`);

  tickets.forEach((t, i) => {
    const priorityColor = t.priority === "critical" ? c.red : t.priority === "high" ? c.yellow : c.dim;
    console.log(`  ${c.bold(`${i + 1}.`)} ${c.cyan(t.externalId || t.id)} ${priorityColor(`[${t.priority}]`)} ${t.title}`);
    console.log(`     ${c.dim(`Reporter: ${t.reporter.name} | Queue: ${t.queue || "unassigned"}`)}`);
  });

  // ── Step 6: Run agent on each ticket ─────────────────────────────────
  banner("Step 5: Running AI Agent on Each Ticket");

  interface TicketResult {
    id: string;
    number: string;
    title: string;
    decision: string;
    confidence: number;
    action: string;
    stepCount: number;
    error: string | null;
  }

  const results: TicketResult[] = [];

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const num = ticket.externalId || ticket.id;

    console.log(`\n${c.bold(c.cyan(`── [${i + 1}/${tickets.length}] ${num}: ${ticket.title.slice(0, 60)} ──`))}\n`);
    console.log(`  ${c.dim("Priority:")} ${ticket.priority}  ${c.dim("Reporter:")} ${ticket.reporter.name}`);
    console.log(`  ${c.dim("Description:")} ${ticket.description.slice(0, 120)}...`);
    console.log();

    try {
      const state = await agent.run(ticket);

      const decisionBadge =
        state.decision === "automate" ? c.bgGreen(` AUTOMATE `) :
        state.decision === "draft_response" ? c.bgCyan(` DRAFT RESPONSE `) :
        state.decision === "escalate" ? c.bgRed(` ESCALATE `) :
        state.decision === "needs_info" ? c.bgYellow(` NEEDS INFO `) :
        c.dim(` ${state.decision} `);

      console.log(`  ${c.bold("Decision:")}   ${decisionBadge}  confidence: ${state.confidence.toFixed(2)}`);
      console.log(`  ${c.bold("Reasoning:")}  ${state.reasoning.slice(0, 200)}${state.reasoning.length > 200 ? "..." : ""}`);

      if (state.draftedReply) {
        console.log(`  ${c.bold("Reply:")}      ${c.green(state.draftedReply.slice(0, 200))}${state.draftedReply.length > 200 ? "..." : ""}`);
      }

      if (state.actionTaken) {
        console.log(`  ${c.bold("Action:")}     ${c.magenta(state.actionTaken.type)}`);
      }

      if (state.steps.length) {
        console.log(`  ${c.bold("Steps:")}`);
        state.steps.forEach((step, j) => {
          console.log(`    ${c.dim(`${j + 1}.`)} ${c.bold(step.node)} ${c.dim(step.summary)}`);
        });
      }

      if (state.error) {
        console.log(`  ${c.red("Error:")} ${state.error}`);
      }

      results.push({
        id: ticket.id,
        number: num,
        title: ticket.title,
        decision: state.decision || "none",
        confidence: state.confidence,
        action: state.actionTaken?.type || "none",
        stepCount: state.steps.length,
        error: state.error,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${c.red("AGENT ERROR:")} ${msg}`);
      results.push({
        id: ticket.id,
        number: num,
        title: ticket.title,
        decision: "error",
        confidence: 0,
        action: "none",
        stepCount: 0,
        error: msg,
      });
    }

    // Small pause between tickets for readability
    if (i < tickets.length - 1) {
      console.log();
      hr();
      await sleep(500);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────
  banner("Results Summary");

  const autoCount = results.filter(r => r.decision === "automate").length;
  const draftCount = results.filter(r => r.decision === "draft_response").length;
  const escalateCount = results.filter(r => r.decision === "escalate").length;
  const infoCount = results.filter(r => r.decision === "needs_info").length;
  const errorCount = results.filter(r => r.decision === "error").length;

  console.log(`  ${c.bgGreen(` AUTOMATE `)}       ${autoCount} ticket(s) - fully resolved by agent`);
  console.log(`  ${c.bgCyan(` DRAFT RESPONSE `)} ${draftCount} ticket(s) - agent drafted a helpful reply`);
  console.log(`  ${c.bgRed(` ESCALATE `)}        ${escalateCount} ticket(s) - forwarded to human team`);
  console.log(`  ${c.bgYellow(` NEEDS INFO `)}     ${infoCount} ticket(s) - asked reporter for details`);
  if (errorCount > 0) {
    console.log(`  ${c.red("ERROR")}              ${errorCount} ticket(s) - agent encountered an error`);
  }

  console.log();
  console.log(`  ${c.bold("Per-ticket breakdown:")}`);
  console.log();

  for (const r of results) {
    const badge =
      r.decision === "automate" ? c.green("✓ AUTO") :
      r.decision === "draft_response" ? c.cyan("✓ DRAFT") :
      r.decision === "escalate" ? c.red("↗ ESC") :
      r.decision === "needs_info" ? c.yellow("? INFO") :
      c.red("✗ ERR");

    console.log(`  ${badge}  ${c.bold(r.number)}  ${r.title.slice(0, 50).padEnd(50)}  conf: ${r.confidence.toFixed(2)}  steps: ${r.stepCount}`);
  }

  console.log();
  hr();
  console.log(`\n  ${c.bold("TierZero")} processed ${results.length} tickets in ${dryRun ? "dry-run" : "live"} mode.`);
  console.log(`  ${c.dim("Agent autonomously handled")} ${autoCount + draftCount} ${c.dim("of")} ${results.length} ${c.dim("tickets without human intervention.")}\n`);

  // Cleanup
  server.close();
  process.exit(0);
}

main().catch(err => {
  console.error(`\nFatal: ${err instanceof Error ? err.message : String(err)}\n`);
  console.error(err);
  process.exit(1);
});
