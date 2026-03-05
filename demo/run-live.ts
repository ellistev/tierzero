#!/usr/bin/env tsx
/**
 * TierZero LIVE Demo
 * 
 * Connects to REAL ServiceNow, REAL Chrome, REAL App Insights.
 * Uses RAG to understand what each ticket needs, then executes
 * the actual rebind workflow via browser automation.
 *
 * This is not a toy. This does real work.
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { KnowledgeIndexer } from "../src/rag/indexer";
import { KnowledgeRetriever } from "../src/rag/retriever";
import {
  connectBrowser,
  scrapeServiceNowTickets,
  downloadSnowAttachment,
  queryAppInsights,
  executeRequoteRebind,
  postServiceNowComment,
  type ScrapedTicket,
  type WorkflowLogger,
} from "../src/workflows/browser-tools";
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
  console.log("\n" + c.bold(c.cyan("╔" + "═".repeat(78) + "╗")));
  console.log(c.bold(c.cyan("║")) + " " + c.bold(text.padEnd(77)) + c.bold(c.cyan("║")));
  console.log(c.bold(c.cyan("╚" + "═".repeat(78) + "╝")) + "\n");
}

function hr() { console.log(c.dim("─".repeat(80))); }

const logger: WorkflowLogger = {
  log: (msg) => console.log(`  ${msg}`),
  warn: (msg) => console.log(`  ${c.yellow("⚠️")}  ${msg}`),
  error: (msg) => console.error(`  ${c.red("❌")} ${msg}`),
  step: (step, detail) => console.log(`\n${c.bold(c.cyan(step))}: ${detail}`),
};

// ---------------------------------------------------------------------------
// RAG-powered decision making
// ---------------------------------------------------------------------------

const decisionSchema = z.object({
  decision: z.enum(["automate_rebind", "draft_response", "escalate", "needs_info", "skip"]),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  suggestedAction: z.string(),
});

async function ragDecide(
  ticket: ScrapedTicket,
  retriever: KnowledgeRetriever,
  model: string
): Promise<z.infer<typeof decisionSchema>> {
  // RAG lookup
  const query = `${ticket.shortDesc} ${ticket.description?.slice(0, 300) || ""}`;
  const ragResult = await retriever.search(query, { mmr: true, k: 5 });
  const { KnowledgeRetriever: KR } = await import("../src/rag/retriever");
  const kbContext = KR.formatForPrompt(ragResult);

  const llm = new ChatOpenAI({ model, temperature: 0 });
  const structured = llm.withStructuredOutput(decisionSchema);

  const systemPrompt =
    `You are TierZero, an AI IT operations agent. You receive support tickets and ` +
    `decide how to handle them based on your knowledge base.\n\n` +
    `Decisions:\n` +
    `- "automate_rebind": This is a bind failure / requote ticket that matches the SGI Requote Rebind procedure. The agent will execute the full rebind workflow automatically.\n` +
    `- "draft_response": Useful guidance exists in KB. Draft a helpful reply.\n` +
    `- "escalate": Out of scope, requires physical access, or low confidence.\n` +
    `- "needs_info": Ticket is too vague to act on.\n` +
    `- "skip": Already resolved or not actionable.\n\n` +
    `For bind failures with "Cannot access payment info" error and a JSON attachment, always choose "automate_rebind".`;

  const userPrompt =
    `## Ticket\n` +
    `INC: ${ticket.incNumber}\n` +
    `Short Description: ${ticket.shortDesc}\n` +
    `Has GW Error: ${ticket.hasGwError}\n` +
    `Old Job Number: ${ticket.oldJobNumber || "N/A"}\n` +
    `Has Attachment: ${ticket.attachmentSysId ? "Yes" : "No"}\n` +
    `Already Fixed: ${ticket.alreadyFixed}\n\n` +
    `Description:\n${ticket.description?.slice(0, 1000) || "(empty)"}\n\n` +
    `## Knowledge Base\n${kbContext}`;

  const result = await structured.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const gatherOnly = process.argv.includes("--gather-only");
  const model = process.argv.includes("--model")
    ? process.argv[process.argv.indexOf("--model") + 1]
    : "gpt-4o-mini";
  const skipIndex = process.argv.includes("--skip-index");

  const outputDir = path.resolve(__dirname, "..", "json-payloads");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  banner("TierZero LIVE - AI Ticket Resolution Agent");
  console.log(`  ${c.bold("Mode:")}        ${dryRun ? c.yellow("DRY RUN") : gatherOnly ? c.yellow("GATHER ONLY") : c.green("LIVE EXECUTION")}`);
  console.log(`  ${c.bold("Model:")}       ${c.cyan(model)}`);
  console.log(`  ${c.bold("ServiceNow:")} sgico.service-now.com (real)`);
  console.log(`  ${c.bold("DRIVE:")}       drive.sgicloud.ca (real)`);
  console.log(`  ${c.bold("App Insights:")} SGI-INS-PRD (real)`);
  console.log(`  ${c.bold("Output:")}      ${outputDir}`);
  console.log();

  // Step 1: Check/index knowledge base
  if (!skipIndex) {
    banner("Step 1: Indexing Knowledge Base (ChromaDB)");
    const knowledgeDir = path.resolve(__dirname, "..", "knowledge");

    // Check ChromaDB
    let chromaOk = false;
    try {
      const res = await fetch("http://localhost:8000/api/v2/heartbeat").catch(() => null);
      if (res && res.ok) chromaOk = true;
      else {
        const res2 = await fetch("http://localhost:8000/api/v1/heartbeat").catch(() => null);
        if (res2 && res2.ok) chromaOk = true;
      }
    } catch {}

    if (!chromaOk) {
      console.log(`  ${c.red("✗")} ChromaDB not running. Start: chroma run --host localhost --port 8000`);
      process.exit(1);
    }

    const indexer = new KnowledgeIndexer({
      knowledgeDir,
      collectionName: "tierzero-live",
      chromaUrl: "http://localhost:8000",
      chunkSize: 800,
      chunkOverlap: 150,
    });

    const result = await indexer.index({ force: false });
    console.log(`  ${c.green("✓")} Indexed ${result.filesProcessed} files, ${result.chunksAdded} chunks`);
  } else {
    console.log(`  ${c.yellow("⏭")} Skipping indexing`);
  }

  const retriever = new KnowledgeRetriever({
    collectionName: "tierzero-live",
    chromaUrl: "http://localhost:8000",
    k: 5,
    scoreThreshold: 0.3,
  });

  // Step 2: Connect to Chrome
  banner("Step 2: Connecting to Chrome");
  const browser = await connectBrowser();

  // Step 3: Scrape ServiceNow
  banner("Step 3: Scraping ServiceNow");
  const { context: snowContext, page: snowPage, tickets } = await scrapeServiceNowTickets(browser, logger);

  if (tickets.length === 0) {
    console.log(`  ${c.dim("No tickets found. Done.")}`);
    browser.close().catch(() => {});
    process.exit(0);
  }

  console.log(`\n  ${c.bold(`Found ${tickets.length} ticket(s):`)}`)
  tickets.forEach((t, i) => {
    const status = t.alreadyFixed ? c.dim("[DONE]") : t.hasGwError ? c.green("[GW ERROR]") : c.dim("[OTHER]");
    console.log(`  ${i + 1}. ${status} ${t.incNumber}: ${t.shortDesc} | Job: ${t.oldJobNumber || "N/A"}`);
  });

  // Step 4: RAG-powered decisions
  banner("Step 4: AI Agent Making Decisions (RAG + LLM)");

  interface TicketPlan {
    ticket: ScrapedTicket;
    decision: z.infer<typeof decisionSchema>;
  }

  const plans: TicketPlan[] = [];

  for (const ticket of tickets) {
    console.log(`\n  ${c.bold(ticket.incNumber)}: ${ticket.shortDesc}`);

    const decision = await ragDecide(ticket, retriever, model);

    const badge =
      decision.decision === "automate_rebind" ? c.green("🤖 AUTOMATE") :
      decision.decision === "draft_response" ? c.cyan("📝 DRAFT") :
      decision.decision === "escalate" ? c.red("↗ ESCALATE") :
      decision.decision === "needs_info" ? c.yellow("❓ NEEDS INFO") :
      c.dim("⏭ SKIP");

    console.log(`    ${badge} (confidence: ${decision.confidence.toFixed(2)})`);
    console.log(`    ${c.dim(decision.reasoning.slice(0, 150))}`);

    plans.push({ ticket, decision });
  }

  // Summary before execution
  const automatable = plans.filter(p => p.decision.decision === "automate_rebind");
  const skippable = plans.filter(p => p.decision.decision === "skip" || p.decision.decision === "needs_info" || p.decision.decision === "escalate" || p.decision.decision === "draft_response");

  hr();
  console.log(`\n  ${c.bold("Plan:")} ${automatable.length} to automate, ${skippable.length} to skip/escalate/draft`);

  if (gatherOnly) {
    console.log(`\n  ${c.yellow("Gather-only mode. Stopping before execution.")}`);

    // Save gather log
    const gatherLog = {
      timestamp: new Date().toISOString(),
      tickets: plans.map(p => ({
        incNumber: p.ticket.incNumber,
        shortDesc: p.ticket.shortDesc,
        decision: p.decision.decision,
        confidence: p.decision.confidence,
        reasoning: p.decision.reasoning,
        oldJobNumber: p.ticket.oldJobNumber,
        hasAttachment: !!p.ticket.attachmentSysId,
      })),
    };
    const logPath = path.join(outputDir, `tierzero-gather-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(logPath, JSON.stringify(gatherLog, null, 2));
    console.log(`  📄 Saved to ${logPath}`);

    browser.close().catch(() => {});
    process.exit(0);
  }

  if (dryRun) {
    console.log(`\n  ${c.yellow("Dry-run mode. No actions taken.")}`);
    browser.close().catch(() => {});
    process.exit(0);
  }

  if (automatable.length === 0) {
    console.log(`\n  ${c.dim("Nothing to automate. Done.")}`);
    browser.close().catch(() => {});
    process.exit(0);
  }

  // Step 5: Execute
  banner("Step 5: Executing Rebind Workflows");

  let success = 0;
  let failed = 0;

  for (let i = 0; i < automatable.length; i++) {
    const { ticket } = automatable[i];
    console.log(`\n${c.bold(`[${i + 1}/${automatable.length}] ${ticket.incNumber} - Job ${ticket.oldJobNumber}`)}`);
    hr();

    // Download attachment if needed
    let jsonPath = path.join(outputDir, `${ticket.oldJobNumber}.json`);
    if (!fs.existsSync(jsonPath)) {
      const downloaded = await downloadSnowAttachment(snowPage, ticket, outputDir, logger);
      if (!downloaded) {
        logger.error("Cannot proceed without JSON file");
        failed++;
        continue;
      }
      jsonPath = downloaded;
    } else {
      logger.log(`✓ ${ticket.oldJobNumber}.json already exists locally`);
    }

    // Execute rebind
    const rebindResult = await executeRequoteRebind(browser, ticket, jsonPath, logger);

    // Post comment
    const message = rebindResult.success
      ? "requote bound, and payments sent to gwbc"
      : `Requote rebind failed for job ${ticket.oldJobNumber} - needs manual intervention`;

    const updatePage = await snowContext.newPage();
    await postServiceNowComment(updatePage, ticket, message, logger);

    if (rebindResult.success) {
      success++;
      logger.log(`${c.green("✅")} ${ticket.incNumber} COMPLETE`);
    } else {
      failed++;
      logger.warn(`${ticket.incNumber} failed: ${rebindResult.error || "unknown"}`);
    }
  }

  // Final summary
  banner("Pipeline Complete");
  console.log(`  ${c.green("✅ Success:")} ${success}`);
  console.log(`  ${c.red("❌ Failed:")}  ${failed}`);
  console.log(`  ${c.dim("⏭ Skipped:")} ${skippable.length}`);
  console.log();

  // Save results log
  const resultsLog = {
    timestamp: new Date().toISOString(),
    success,
    failed,
    skipped: skippable.length,
    plans: plans.map(p => ({
      incNumber: p.ticket.incNumber,
      decision: p.decision.decision,
      confidence: p.decision.confidence,
      oldJobNumber: p.ticket.oldJobNumber,
    })),
  };
  const logPath = path.join(outputDir, `tierzero-run-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(logPath, JSON.stringify(resultsLog, null, 2));
  console.log(`  📄 Results saved to ${logPath}`);

  browser.close().catch(() => {});
}

main().catch(err => {
  console.error(`\n${c.red("Fatal:")} ${err instanceof Error ? err.message : String(err)}`);
  console.error(err);
  process.exit(1);
});
