#!/usr/bin/env tsx
/**
 * TierZero LIVE Demo
 * 
 * Connects to REAL ServiceNow, REAL Chrome, REAL App Insights.
 * Uses RAG + workflow registry to understand and execute ticket automation.
 *
 * Usage:
 *   npm run live              # full execution
 *   npm run live:dry          # dry-run (no actions)
 *   npm run live:gather       # scrape + decide, no execute
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { KnowledgeIndexer } from "../src/rag/indexer";
import { KnowledgeRetriever } from "../src/rag/retriever";
import { connectChrome } from "../src/browser/connection";
import { openServiceNow, listTickets, readTicketDetail, postComment } from "../src/browser/servicenow-scraper";
import { DRIVE_ALERTS_LIST_URL } from "../src/browser/servicenow-scraper";
import { WorkflowRegistry } from "../src/workflows/registry";
import { RequoteRebindExecutor, PlateLookupExecutor, QueryHelperExecutor } from "../src/workflows/executors";
import type { WorkflowLogger, WorkflowContext } from "../src/workflows/types";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

// ---------------------------------------------------------------------------
// ANSI
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
};

function banner(text: string) {
  console.log("\n" + c.bold(c.cyan("+" + "-".repeat(78) + "+")));
  console.log(c.bold(c.cyan("|")) + " " + c.bold(text.padEnd(77)) + c.bold(c.cyan("|")));
  console.log(c.bold(c.cyan("+" + "-".repeat(78) + "+")) + "\n");
}

function hr() { console.log(c.dim("-".repeat(80))); }

const logger: WorkflowLogger = {
  log: (msg) => console.log(`  ${msg}`),
  warn: (msg) => console.log(`  ${c.yellow("!")}  ${msg}`),
  error: (msg) => console.error(`  ${c.red("X")} ${msg}`),
  step: (step, detail) => console.log(`\n${c.bold(c.cyan(step))}: ${detail}`),
};

// ---------------------------------------------------------------------------
// RAG-enhanced decision (confirms workflow registry match)
// ---------------------------------------------------------------------------

const ragDecisionSchema = z.object({
  shouldAutomate: z.boolean().describe("Whether the ticket should be automated"),
  workflowId: z.string().describe("Which workflow to use (requote-rebind, plate-lookup, query-helper, or 'none')"),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

async function ragConfirmDecision(
  ticket: { incNumber: string; shortDesc: string; description: string },
  registryMatchId: string | null,
  retriever: KnowledgeRetriever,
  model: string
): Promise<z.infer<typeof ragDecisionSchema>> {
  const query = `${ticket.shortDesc} ${ticket.description?.slice(0, 300) || ""}`;
  const ragResult = await retriever.search(query, { mmr: true, k: 5 });
  const { KnowledgeRetriever: KR } = await import("../src/rag/retriever");
  const kbContext = KR.formatForPrompt(ragResult);

  const llm = new ChatOpenAI({ model, temperature: 0 });
  const structured = llm.withStructuredOutput(ragDecisionSchema);

  const systemPrompt =
    `You are TierZero's decision engine. Given a ticket and knowledge base context, ` +
    `confirm whether automation is appropriate and which workflow to use.\n\n` +
    `Available workflows:\n` +
    `- requote-rebind: SGI bind failure resolution (requires "Cannot access payment info" error + JSON attachment)\n` +
    `- plate-lookup: Find plate numbers from job numbers or registration IDs\n` +
    `- query-helper: Cross-reference IDs across SGI systems\n` +
    `- none: No automation available, escalate to human\n\n` +
    `The workflow registry suggested: ${registryMatchId || "no match"}.\n` +
    `Confirm or override based on the knowledge base context.`;

  return structured.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(
      `Ticket: ${ticket.incNumber}\n` +
      `Short: ${ticket.shortDesc}\n` +
      `Description:\n${ticket.description?.slice(0, 1000) || "(empty)"}\n\n` +
      `Knowledge Base:\n${kbContext}`
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const gatherOnly = process.argv.includes("--gather-only");
  const skipIndex = process.argv.includes("--skip-index");
  const model = process.argv.includes("--model")
    ? process.argv[process.argv.indexOf("--model") + 1]
    : "gpt-4o-mini";

  const workDir = path.resolve(__dirname, "..", "json-payloads");
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  banner("TierZero LIVE - AI Ticket Resolution Agent");
  console.log(`  ${c.bold("Mode:")}        ${dryRun ? c.yellow("DRY RUN") : gatherOnly ? c.yellow("GATHER ONLY") : c.green("LIVE EXECUTION")}`);
  console.log(`  ${c.bold("Model:")}       ${c.cyan(model)}`);
  console.log(`  ${c.bold("ServiceNow:")} sgico.service-now.com (REAL)`);
  console.log(`  ${c.bold("DRIVE:")}       drive.sgicloud.ca (REAL)`);
  console.log(`  ${c.bold("App Insights:")} SGI-INS-PRD (REAL)`);
  console.log(`  ${c.bold("Output:")}      ${workDir}`);

  // ── Step 1: Knowledge Base ────────────────────────────────────
  banner("Step 1: Knowledge Base (ChromaDB + RAG)");

  if (!skipIndex) {
    let chromaOk = false;
    try {
      const res = await fetch("http://localhost:8000/api/v2/heartbeat").catch(() => null);
      if (!res || !res.ok) {
        const res2 = await fetch("http://localhost:8000/api/v1/heartbeat").catch(() => null);
        chromaOk = !!(res2 && res2.ok);
      } else chromaOk = true;
    } catch {}

    if (!chromaOk) {
      console.log(`  ${c.red("X")} ChromaDB not running. Start: chroma run --host localhost --port 8000`);
      process.exit(1);
    }

    const indexer = new KnowledgeIndexer({
      knowledgeDir: path.resolve(__dirname, "..", "knowledge"),
      collectionName: "tierzero-live",
      chromaUrl: "http://localhost:8000",
      chunkSize: 800,
      chunkOverlap: 150,
    });

    const result = await indexer.index({ force: false });
    console.log(`  ${c.green("OK")} Indexed ${result.filesProcessed} files, ${result.chunksAdded} chunks`);
  }

  const retriever = new KnowledgeRetriever({
    collectionName: "tierzero-live",
    chromaUrl: "http://localhost:8000",
    k: 5,
    scoreThreshold: 0.3,
  });

  // ── Step 2: Workflow Registry ─────────────────────────────────
  banner("Step 2: Workflow Registry");

  const registry = new WorkflowRegistry();
  registry.register(new RequoteRebindExecutor());
  registry.register(new PlateLookupExecutor());
  registry.register(new QueryHelperExecutor());

  console.log(`  ${c.green("OK")} ${registry.list().length} workflows registered:`);
  for (const wf of registry.list()) {
    console.log(`     - ${c.cyan(wf.id)}: ${wf.description.slice(0, 60)}`);
  }

  // ── Step 3: Connect to Chrome ─────────────────────────────────
  banner("Step 3: Chrome + ServiceNow");

  const browser = await connectChrome();
  console.log(`  ${c.green("OK")} Connected to Chrome (CDP)`);

  const snowSession = await openServiceNow(browser, {
    onWaiting: () => logger.warn("Please log into ServiceNow in the browser tab"),
    onLoggedIn: () => logger.log("ServiceNow login detected!"),
  });
  console.log(`  ${c.green("OK")} ServiceNow session ready`);

  // ── Step 4: Scrape Tickets ────────────────────────────────────
  banner("Step 4: Scraping Tickets");

  const ticketSummaries = await listTickets(snowSession, DRIVE_ALERTS_LIST_URL);
  console.log(`  Found ${ticketSummaries.length} DRIVE Alerts ticket(s)`);

  if (ticketSummaries.length === 0) {
    console.log(`  ${c.dim("No tickets. Done.")}`);
    process.exit(0);
  }

  // Read details for each ticket
  const tickets = [];
  for (const summary of ticketSummaries) {
    try {
      const detail = await readTicketDetail(snowSession, summary);
      tickets.push(detail);
      const status = detail.alreadyFixed ? c.dim("[DONE]") : detail.hasGwError ? c.green("[GW]") : c.dim("[--]");
      console.log(`  ${status} ${detail.incNumber}: ${detail.shortDesc} | Job: ${detail.oldJobNumber || "N/A"}`);
    } catch (err) {
      logger.warn(`Could not read ${summary.incNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Step 5: Decide + Plan ─────────────────────────────────────
  banner("Step 5: AI Decision Engine (Registry + RAG + LLM)");

  interface Plan {
    ticket: typeof tickets[0];
    registryMatch: string | null;
    ragDecision: z.infer<typeof ragDecisionSchema>;
  }

  const plans: Plan[] = [];

  for (const ticket of tickets) {
    // First: fast registry check
    const match = registry.findBest(ticket);
    const registryMatchId = match?.executor.id ?? null;

    // Second: RAG + LLM confirmation
    const ragDecision = await ragConfirmDecision(ticket, registryMatchId, retriever, model);

    const badge =
      ragDecision.shouldAutomate ? c.green("AUTOMATE") :
      ragDecision.workflowId === "none" ? c.red("ESCALATE") :
      c.yellow("MANUAL");

    console.log(`  ${c.bold(ticket.incNumber)}: ${badge} [${ragDecision.workflowId}] conf=${ragDecision.confidence.toFixed(2)}`);
    console.log(`    ${c.dim(ragDecision.reasoning.slice(0, 120))}`);

    plans.push({ ticket, registryMatch: registryMatchId, ragDecision });
  }

  // Summary
  const automatable = plans.filter(p => p.ragDecision.shouldAutomate && p.ragDecision.workflowId !== "none");
  const skipped = plans.filter(p => !p.ragDecision.shouldAutomate || p.ragDecision.workflowId === "none");

  hr();
  console.log(`\n  ${c.bold("Plan:")} ${automatable.length} to automate, ${skipped.length} to skip/escalate`);

  // Save gather log
  const gatherLog = {
    timestamp: new Date().toISOString(),
    mode: dryRun ? "dry-run" : gatherOnly ? "gather-only" : "live",
    tickets: plans.map(p => ({
      incNumber: p.ticket.incNumber,
      shortDesc: p.ticket.shortDesc,
      registryMatch: p.registryMatch,
      workflowId: p.ragDecision.workflowId,
      shouldAutomate: p.ragDecision.shouldAutomate,
      confidence: p.ragDecision.confidence,
      reasoning: p.ragDecision.reasoning,
      oldJobNumber: p.ticket.oldJobNumber,
    })),
  };
  const logPath = path.join(workDir, `tierzero-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(logPath, JSON.stringify(gatherLog, null, 2));
  console.log(`  Log: ${logPath}`);

  if (gatherOnly || dryRun || automatable.length === 0) {
    if (gatherOnly) console.log(`\n  ${c.yellow("Gather-only mode. Stopping.")}`);
    if (dryRun) console.log(`\n  ${c.yellow("Dry-run mode. No actions taken.")}`);
    if (automatable.length === 0) console.log(`\n  ${c.dim("Nothing to automate.")}`);
    process.exit(0);
  }

  // ── Step 6: Execute Workflows ─────────────────────────────────
  banner("Step 6: Executing Workflows");

  let success = 0;
  let failed = 0;

  for (let i = 0; i < automatable.length; i++) {
    const { ticket, ragDecision } = automatable[i];
    const executor = registry.get(ragDecision.workflowId);

    if (!executor) {
      logger.error(`No executor for workflow: ${ragDecision.workflowId}`);
      failed++;
      continue;
    }

    console.log(`\n${c.bold(`[${i + 1}/${automatable.length}] ${ticket.incNumber} -> ${executor.name}`)}`);
    hr();

    const ctx: WorkflowContext = {
      browser,
      workDir,
      logger,
      dryRun: false,
    };

    const result = await executor.execute(ticket, ctx);

    // Post comment if workflow produced one
    if (result.ticketComment) {
      try {
        await postComment(snowSession, ticket, result.ticketComment, {
          field: result.commentIsInternal ? "work_notes" : "comments",
        });
        logger.log(`Posted ${result.commentIsInternal ? "internal note" : "comment"} on ${ticket.incNumber}`);
      } catch (err) {
        logger.warn(`Could not post comment: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (result.success) {
      success++;
      console.log(`  ${c.green("OK")} ${ticket.incNumber}: ${result.summary}`);
    } else {
      failed++;
      console.log(`  ${c.red("FAIL")} ${ticket.incNumber}: ${result.error || result.summary}`);
    }

    // Log steps
    for (const step of result.steps) {
      const icon = step.status === "completed" ? c.green("v") : step.status === "failed" ? c.red("x") : c.yellow("-");
      console.log(`    ${icon} ${step.name}: ${step.detail}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  banner("Pipeline Complete");
  console.log(`  ${c.green("Success:")} ${success}`);
  console.log(`  ${c.red("Failed:")}  ${failed}`);
  console.log(`  ${c.dim("Skipped:")} ${skipped.length}`);
  console.log();
}

main().catch(err => {
  console.error(`\n${c.red("Fatal:")} ${err instanceof Error ? err.message : String(err)}`);
  console.error(err);
  process.exit(1);
});
