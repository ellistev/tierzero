#!/usr/bin/env tsx
/**
 * TierZero LIVE Demo Runner
 * 
 * Generic runner that loads a demo config, initializes skills,
 * and runs the workflow pipeline against real systems.
 *
 * Usage:
 *   npm run live -- --demo sgi           # full execution
 *   npm run live -- --demo sgi --dry-run # dry-run
 *   npm run live -- --demo sgi --gather-only
 *   npm run live -- --demo sgi --resume       # resume unprocessed items from gather log
 *   npm run live -- --demo sgi --update-only  # post ServiceNow comments for completed items
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import websql from "websql";
import { SkillLoader } from "../src/skills/loader";
import { WorkflowRegistry } from "../src/workflows/registry";
import { connectChrome } from "../src/browser/connection";
import type { WorkflowLogger, WorkflowContext, Ticket } from "../src/workflows/types";
import { Ticket as TicketAggregate } from "../src/domain/ticket/Ticket";
import { ReceiveTicket, AnalyzeTicket, MatchToWorkflow, EscalateTicket, ResolveTicket, PostComment } from "../src/domain/ticket/commands";
import { ticketEventFactories } from "../src/domain/ticket/events";
import { WorkflowExecution as WorkflowExecutionAggregate } from "../src/domain/workflow-execution/WorkflowExecution";
import { StartWorkflowExecution, StartStep, CompleteStep, FailStep, SkipStep, CompleteExecution, FailExecution } from "../src/domain/workflow-execution/commands";
import { workflowExecutionEventFactories } from "../src/domain/workflow-execution/events";
import { ticketsReadModel } from "../src/read-models/tickets";
import { workflowExecutionsReadModel } from "../src/read-models/workflow-executions";
import { ticketStatsReadModel } from "../src/read-models/ticket-stats";
import defaultEventFactory from "../src/infra/defaultEventFactory.js";
import KurrentDBEventStore from "../src/infra/kurrentdb/index.js";
import DBPool from "../src/infra/websqldb/DBPool.js";
import Mapper from "../src/infra/websqldb/Mapper.js";
import CheckPointStore from "../src/infra/websqldb/CheckPointStore.js";
import { buildModelDefs } from "../src/infra/readModels.js";
import ReadRepository from "../src/infra/ReadRepository.js";
import TransactionalRepository from "../src/infra/TransactionalRepository.js";
import Batcher from "../src/infra/Batcher.js";
import { factory as builderFactory } from "../src/infra/builder.js";
import EventStoreWithConversionWrapper from "../src/infra/EventStoreWithConversionWrapper.js";
import Subscriber from "../src/infra/Subscriber.js";
import commandHandlerFactory from "../src/infra/commandHandler.js";
import NullAggregateCache from "../src/infra/in-process/NullAggregateCache.js";
import NullSnapshotStore from "../src/infra/in-process/NullSnapshotStore.js";
import NullMetrics from "../src/infra/metrics/NullMetrics.js";
// getTypeName no longer needed - KurrentDB handles type names internally

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
};

function banner(text: string) {
  console.log("\n" + c.bold(c.cyan("+" + "-".repeat(78) + "+")));
  console.log(c.bold(c.cyan("|")) + " " + c.bold(text.padEnd(77)) + c.bold(c.cyan("|")));
  console.log(c.bold(c.cyan("+" + "-".repeat(78) + "+")) + "\n");
}

const logger: WorkflowLogger = {
  log: (msg) => console.log(`  ${msg}`),
  warn: (msg) => console.log(`  ${c.yellow("!")} ${msg}`),
  error: (msg) => console.error(`  ${c.red("X")} ${msg}`),
  step: (step, detail) => console.log(`\n${c.bold(c.cyan(step))}: ${detail}`),
};

// ---------------------------------------------------------------------------
// Simple YAML parser (enough for our config format)
// ---------------------------------------------------------------------------

function parseSimpleYaml(text: string): Record<string, unknown> {
  const lines = text.split("\n");
  const result: Record<string, unknown> = {};
  let currentSection = "";
  let currentSubSection = "";

  for (const line of lines) {
    if (line.trim().startsWith("#") || line.trim() === "") continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    if (indent === 0 && content.endsWith(":")) {
      currentSection = content.slice(0, -1);
      result[currentSection] = {};
      currentSubSection = "";
    } else if (indent === 2 && content.endsWith(":")) {
      currentSubSection = content.slice(0, -1);
      (result[currentSection] as Record<string, unknown>)[currentSubSection] = {};
    } else if (content.includes(": ")) {
      const [key, ...valueParts] = content.split(": ");
      let value: unknown = valueParts.join(": ").replace(/^["']|["']$/g, "");

      if (typeof value === "string") {
        const envMatch = (value as string).match(/^\$\{(\w+)\}$/);
        if (envMatch && process.env[envMatch[1]]) {
          value = process.env[envMatch[1]];
        }
      }

      if (currentSubSection && currentSection) {
        ((result[currentSection] as Record<string, unknown>)[currentSubSection] as Record<string, unknown>)[key] = value;
      } else if (currentSection) {
        (result[currentSection] as Record<string, unknown>)[key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Gather log helpers
// ---------------------------------------------------------------------------

interface GatherLogItem {
  id: string;
  title: string;
  executor: string | null;
  decision: string;
  ticket: Ticket;
  processedStatus?: "success" | "failed" | "skipped";
  processedAt?: string;
  snowUpdated?: boolean;
  snowUpdatedAt?: string;
  alreadyFixed?: boolean;
  ticketComment?: string;
  commentIsInternal?: boolean;
  error?: string;
}

interface GatherLog {
  timestamp: string;
  demo: string;
  mode: string;
  items: GatherLogItem[];
}

function getGatherLogPath(workDir: string, date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return path.join(workDir, `tierzero-${d}.json`);
}

function saveGatherLog(logPath: string, log: GatherLog): void {
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
}

function loadLatestGatherLog(workDir: string): { log: GatherLog; logPath: string } | null {
  // Try today first, then scan for most recent
  const today = getGatherLogPath(workDir);
  if (fs.existsSync(today)) {
    return { log: JSON.parse(fs.readFileSync(today, "utf-8")), logPath: today };
  }

  const files = fs.readdirSync(workDir)
    .filter(f => f.startsWith("tierzero-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  const logPath = path.join(workDir, files[0]);
  return { log: JSON.parse(fs.readFileSync(logPath, "utf-8")), logPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const gatherOnly = args.includes("--gather-only");
  const resumeMode = args.includes("--resume");
  const updateOnly = args.includes("--update-only");
  const demoIdx = args.indexOf("--demo");
  const demoName = demoIdx >= 0 ? args[demoIdx + 1] : null;

  if (!demoName) {
    console.error("Usage: tsx demo/run-live.ts --demo <name> [--dry-run] [--gather-only] [--resume] [--update-only]");
    console.error("  e.g. tsx demo/run-live.ts --demo sgi");
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const demoDir = path.join(projectRoot, "demos", demoName);
  const configPath = path.join(demoDir, "config.yaml");

  if (!fs.existsSync(configPath)) {
    console.error(`Demo config not found: ${configPath}`);
    process.exit(1);
  }

  // Load demo .env if present
  const demoEnvPath = path.join(demoDir, ".env");
  if (fs.existsSync(demoEnvPath)) {
    const envContent = fs.readFileSync(demoEnvPath, "utf-8");
    for (const line of envContent.split("\n")) {
      if (line.trim() && !line.startsWith("#")) {
        const [key, ...val] = line.split("=");
        if (key && val.length) process.env[key.trim()] = val.join("=").trim();
      }
    }
  }

  const configRaw = fs.readFileSync(configPath, "utf-8");
  const config = parseSimpleYaml(configRaw);

  if (config.env && typeof config.env === "object") {
    for (const [key, value] of Object.entries(config.env as Record<string, string>)) {
      if (!process.env[key]) process.env[key] = value;
    }
  }

  const workDir = path.join(demoDir, "json-payloads");
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  // ── CQRS/ES Infrastructure ──────────────────────────────────
  const allEventClasses: Record<string, { type: string; prototype: Record<string, unknown> }> = {};
  for (const [type] of Object.entries(ticketEventFactories)) {
    const cls = function() {} as unknown as { type: string; prototype: Record<string, unknown> };
    cls.type = type;
    cls.prototype = { constructor: cls };
    allEventClasses[type] = cls;
  }
  for (const [type] of Object.entries(workflowExecutionEventFactories)) {
    const cls = function() {} as unknown as { type: string; prototype: Record<string, unknown> };
    cls.type = type;
    cls.prototype = { constructor: cls };
    allEventClasses[type] = cls;
  }
  const eventFactory = defaultEventFactory(allEventClasses);

  // Initialize event store (SQLite-backed, persisted to disk)
  const dataDir = path.join(demoDir, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const rmDbPath = path.join(dataDir, "readmodels.db");

  // KurrentDB event store (Docker: localhost:2113, insecure mode)
  const kurrentConnectionString = process.env.KURRENTDB_URL || "esdb://localhost:2113?tls=false";
  const eventStore = new KurrentDBEventStore(kurrentConnectionString, console);
  await eventStore.ensureCreated();

  // Identity event converter (no conversions needed)
  const eventConverter = (esData: unknown) => esData;
  const eventStoreWithConversion = new EventStoreWithConversionWrapper(eventStore, eventConverter);

  // Read model DB
  const readModels = [
    { name: ticketsReadModel.name, ...ticketsReadModel },
    { name: workflowExecutionsReadModel.name, ...workflowExecutionsReadModel },
    { name: ticketStatsReadModel.name, ...ticketStatsReadModel },
  ];
  const modelDefs = buildModelDefs(readModels);
  const rmDb = websql(rmDbPath, "1.0", "", 0);
  const dbPool = new DBPool(rmDb);
  const mapper = new Mapper(modelDefs, console);

  // Ensure read model tables exist
  for (const rm of readModels) {
    await mapper.tryCreateModel(dbPool, rm.name);
  }

  // Read model builder + subscriber
  const metrics = new NullMetrics();
  const checkPointStoreFactory = (key: string) => new CheckPointStore(dbPool, key);
  const transactionalRepositoryFactory = (modelName: string, batcher: unknown, readRepo?: unknown) =>
    new TransactionalRepository(mapper, modelName, readRepo || new ReadRepository(mapper, (batcher as { connection: unknown }).connection, console), batcher, console);
  const readRepository = new ReadRepository(mapper, dbPool, console);
  const builder = builderFactory(
    { dbPool, readRepository, transactionalRepositoryFactory, logger: console, config: {}, metrics },
    eventStoreWithConversion
  );
  const lastCheckPointStore = checkPointStoreFactory("lastCheckPoint");
  const updateLastCheckPoint = (cp: unknown) => lastCheckPointStore.put(cp);
  const subscriber = new Subscriber("readModels", eventStore, updateLastCheckPoint, null, metrics, console);
  subscriber.addHandler((esData: unknown) => builder.processEvent(readModels, esData));

  // Start subscriber from last checkpoint
  const rawLastCheckpoint = await lastCheckPointStore.get();
  const lastCheckPoint = rawLastCheckpoint && eventStore.createPosition(rawLastCheckpoint);
  await subscriber.startFrom(lastCheckPoint);

  // Command handler (write side)
  const aggregateCache = new NullAggregateCache();
  const snapshotStore = new NullSnapshotStore();
  const cqrsCommandHandler = commandHandlerFactory(
    { commandHandler: { snapshotThreshold: 1024, readBatchSize: 512 } },
    eventFactory,
    eventStoreWithConversion,
    aggregateCache,
    snapshotStore,
    console,
    metrics
  );

  // Helper: dispatch a command, swallowing errors to not break the pipeline
  async function dispatch(TAgg: unknown, aggregateId: string, command: unknown) {
    try {
      await cqrsCommandHandler(TAgg, aggregateId, command);
    } catch (err) {
      logger.warn(`CQRS dispatch failed (${(command as { constructor: { type: string } }).constructor.type}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const modeLabel = dryRun ? "DRY RUN" : gatherOnly ? "GATHER ONLY" : resumeMode ? "RESUME" : updateOnly ? "UPDATE ONLY" : "LIVE EXECUTION";
  banner(`TierZero LIVE - ${(config as Record<string, unknown>).name || demoName}`);
  console.log(`  ${c.bold("Demo:")}  ${demoName} (${demoDir})`);
  console.log(`  ${c.bold("Mode:")}  ${dryRun ? c.yellow(modeLabel) : modeLabel === "LIVE EXECUTION" ? c.green(modeLabel) : c.yellow(modeLabel)}`);

  // ── Step 1: Load Skills ───────────────────────────────────────
  banner("Step 1: Loading Skills");

  const skillConfig = (config.skills as Record<string, Record<string, unknown>>) ?? {};

  const skillLoader = new SkillLoader({
    skillDirs: [
      path.join(projectRoot, "skills"),
      path.join(demoDir, "skills"),
    ],
    config: skillConfig,
    logger,
  });

  await skillLoader.loadAll();

  const loadedSkills = skillLoader.getAll();
  console.log(`\n  ${c.green("OK")} ${loadedSkills.length} skill(s) loaded:`);
  for (const skill of loadedSkills) {
    console.log(`     - ${c.cyan(skill.manifest.name)} [${skill.source}] (${skill.provider.listCapabilities().length} capabilities)`);
  }

  // ── Step 2: Load Workflows ────────────────────────────────────
  banner("Step 2: Loading Workflows");

  const registry = new WorkflowRegistry();
  const workflowDir = path.join(demoDir, "workflows");
  const loaded = await registry.loadFromDir(workflowDir);
  console.log(`  ${c.green("OK")} ${loaded} workflow(s) loaded from ${workflowDir}`);

  for (const wf of registry.list()) {
    console.log(`     - ${c.cyan(wf.id)}: ${wf.description.slice(0, 60)}`);
  }

  // ── Step 3: Connect to Chrome ─────────────────────────────────
  banner("Step 3: Browser Connection");

  const browser = await connectChrome();
  console.log(`  ${c.green("OK")} Connected to Chrome (CDP)`);

  // ---------------------------------------------------------------------------
  // --update-only mode: post ServiceNow comments for completed items
  // ---------------------------------------------------------------------------
  if (updateOnly) {
    banner("Update-Only Mode: Posting ServiceNow Comments");

    const latest = loadLatestGatherLog(workDir);
    if (!latest) {
      console.error(`  ${c.red("X")} No gather log found in ${workDir}`);
      process.exit(1);
    }

    const { log: gatherLog, logPath } = latest;
    console.log(`  Loaded gather log: ${logPath}`);

    const toUpdate = gatherLog.items.filter(item =>
      item.processedStatus === "success" &&
      !item.alreadyFixed &&
      !item.snowUpdated &&
      item.ticketComment
    );

    console.log(`  ${toUpdate.length} item(s) need ServiceNow update`);

    if (toUpdate.length === 0) {
      console.log(`  ${c.dim("Nothing to update.")}`);
      process.exit(0);
    }

    // Use incognito context for ServiceNow to avoid SSO conflicts with DRIVE
    const snowContext = await browser.newContext();
    const snowPage = await snowContext.newPage();

    const servicenowSkill = skillLoader.get("servicenow");
    if (!servicenowSkill) {
      console.error(`  ${c.red("X")} servicenow skill not loaded`);
      process.exit(1);
    }

    // Navigate to ServiceNow and wait for SSO login
    logger.warn("Opening ServiceNow in incognito context - please complete SSO login");
    const commentFn = servicenowSkill.provider.getCapability("ticket-comment");
    const checkCommentFn = servicenowSkill.provider.getCapability("ticket-check-comment");

    if (!commentFn) {
      console.error(`  ${c.red("X")} servicenow skill missing ticket-comment capability`);
      process.exit(1);
    }

    for (let i = 0; i < toUpdate.length; i++) {
      const item = toUpdate[i];
      console.log(`\n${c.bold(`[${i + 1}/${toUpdate.length}] ${item.id}`)}`);

      try {
        // Check if ticket already has the completion comment
        if (checkCommentFn) {
          const hasComment = await checkCommentFn(
            { sysId: item.ticket.fields.sysId, incNumber: item.id },
            ["requote bound", "payments sent to gwbc"],
            { page: snowPage }
          );
          if (hasComment) {
            logger.log(`Already has completion comment - skipping`);
            item.snowUpdated = true;
            item.snowUpdatedAt = new Date().toISOString();
            saveGatherLog(logPath, gatherLog);
            continue;
          }
        }

        await commentFn(
          { sysId: item.ticket.fields.sysId, incNumber: item.id },
          item.ticketComment!,
          { field: item.commentIsInternal ? "work_notes" : "comments", page: snowPage }
        );

        item.snowUpdated = true;
        item.snowUpdatedAt = new Date().toISOString();
        logger.log(`Posted comment on ${item.id}`);
      } catch (err) {
        logger.warn(`Comment failed for ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Save after EACH item
      saveGatherLog(logPath, gatherLog);
    }

    await snowContext.close();
    banner("Update Complete");
    const updated = toUpdate.filter(i => i.snowUpdated).length;
    console.log(`  ${c.green("Updated:")} ${updated}/${toUpdate.length}\n`);
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // --resume mode: load gather log, skip scraping, execute unprocessed items
  // ---------------------------------------------------------------------------
  if (resumeMode) {
    banner("Resume Mode: Loading Gather Log");

    const latest = loadLatestGatherLog(workDir);
    if (!latest) {
      console.error(`  ${c.red("X")} No gather log found in ${workDir}`);
      process.exit(1);
    }

    const { log: gatherLog, logPath } = latest;
    console.log(`  Loaded gather log: ${logPath}`);
    console.log(`  Total items: ${gatherLog.items.length}`);

    const unprocessed = gatherLog.items.filter(item =>
      !item.processedStatus && item.decision === "execute" && item.executor
    );

    console.log(`  Unprocessed items to execute: ${unprocessed.length}`);

    if (unprocessed.length === 0) {
      console.log(`  ${c.dim("Nothing to resume.")}`);
      process.exit(0);
    }

    banner("Executing Unprocessed Items");

    let success = 0, failed = 0;

    for (let i = 0; i < unprocessed.length; i++) {
      const item = unprocessed[i];
      const executor = registry.get(item.executor!);
      if (!executor) {
        item.processedStatus = "failed";
        item.processedAt = new Date().toISOString();
        item.error = `Executor ${item.executor} not found`;
        failed++;
        saveGatherLog(logPath, gatherLog);
        continue;
      }

      console.log(`\n${c.bold(`[${i + 1}/${unprocessed.length}] ${item.id} -> ${executor.name}`)}`);

      // Use default context for DRIVE operations
      const ctx: WorkflowContext = { browser, skills: skillLoader, workDir, logger, dryRun: false };
      const result = await executor.execute(item.ticket, ctx);

      item.processedStatus = result.success ? "success" : "failed";
      item.processedAt = new Date().toISOString();
      if (result.ticketComment) item.ticketComment = result.ticketComment;
      if (result.commentIsInternal) item.commentIsInternal = result.commentIsInternal;
      if (result.error) item.error = result.error;

      if (result.success) {
        success++;
        console.log(`  ${c.green("OK")} ${result.summary}`);
      } else {
        failed++;
        console.log(`  ${c.red("FAIL")} ${result.error || result.summary}`);
      }

      for (const step of result.steps) {
        const icon = step.status === "completed" ? c.green("v") : step.status === "failed" ? c.red("x") : c.yellow("-");
        console.log(`    ${icon} ${step.name}: ${step.detail}`);
      }

      // Save after EACH item
      saveGatherLog(logPath, gatherLog);
    }

    banner("Resume Complete");
    console.log(`  ${c.green("Success:")} ${success}  ${c.red("Failed:")} ${failed}\n`);
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // Normal flow: Steps 4-6
  // ---------------------------------------------------------------------------

  // ── Step 4: Scrape Tickets ────────────────────────────────────
  banner("Step 4: Scraping Tickets");

  const servicenowSkill = skillLoader.get("servicenow");
  if (!servicenowSkill) {
    console.error(`  ${c.red("X")} servicenow skill not loaded`);
    process.exit(1);
  }

  const listFn = servicenowSkill.provider.getCapability("ticket-list");
  if (!listFn) {
    console.error(`  ${c.red("X")} servicenow skill missing ticket-list capability`);
    process.exit(1);
  }

  const rawTickets = await listFn(browser, {
    onWaiting: () => logger.warn("Please log into ServiceNow"),
    onLoggedIn: () => logger.log("ServiceNow login detected!"),
  }) as Array<{ incNumber: string; sysId: string; shortDesc: string }>;

  console.log(`  Found ${rawTickets.length} ticket(s)`);

  if (rawTickets.length === 0) {
    console.log(`  ${c.dim("No tickets. Done.")}`);
    process.exit(0);
  }

  const readFn = servicenowSkill.provider.getCapability("ticket-read");
  const tickets: Ticket[] = [];

  for (const raw of rawTickets) {
    try {
      const detail = readFn ? await readFn(raw) as Record<string, unknown> : null;
      const ticket: Ticket = {
        id: (detail?.incNumber as string) || raw.incNumber,
        title: raw.shortDesc,
        description: (detail?.description as string) || "",
        source: "servicenow",
        fields: {
          sysId: raw.sysId,
          ...(detail?.extracted as Record<string, unknown> ?? {}),
          attachmentSysId: detail?.attachmentSysId,
          attachmentName: detail?.attachmentName,
        },
      };
      tickets.push(ticket);
      console.log(`  ${c.dim(ticket.id)}: ${ticket.title}`);

      // CQRS: ReceiveTicket
      await dispatch(TicketAggregate, ticket.id, new ReceiveTicket(
        ticket.id, ticket.title, ticket.description, ticket.source, ticket.fields, new Date().toISOString()
      ));
    } catch (err) {
      logger.warn(`Could not read ${raw.incNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Step 5: Match & Decide ────────────────────────────────────
  banner("Step 5: Matching Workflows");

  interface Plan {
    ticket: Ticket;
    executorId: string | null;
    decision: string;
  }

  const plans: Plan[] = [];

  for (const ticket of tickets) {
    const match = registry.findBest(ticket);
    const decision = match ? match.decision : "skip";
    const executorId = match?.executor.id ?? null;

    const badge =
      decision === "execute" ? c.green("AUTOMATE") :
      decision === "needs_info" ? c.yellow("NEEDS INFO") :
      c.dim("SKIP");

    console.log(`  ${c.bold(ticket.id)}: ${badge} ${executorId ? `[${executorId}]` : ""}`);
    plans.push({ ticket, executorId, decision });

    // CQRS: AnalyzeTicket
    const now = new Date().toISOString();
    await dispatch(TicketAggregate, ticket.id, new AnalyzeTicket(
      ticket.id, ticket.fields, decision, now
    ));

    // CQRS: MatchToWorkflow or EscalateTicket
    if (executorId) {
      await dispatch(TicketAggregate, ticket.id, new MatchToWorkflow(
        ticket.id, executorId, match?.confidence ?? 1.0, now
      ));
    } else {
      await dispatch(TicketAggregate, ticket.id, new EscalateTicket(
        ticket.id, decision === "skip" ? "No matching workflow" : decision, now
      ));
    }
  }

  const automatable = plans.filter(p => p.decision === "execute" && p.executorId);
  const skipped = plans.filter(p => p.decision !== "execute" || !p.executorId);

  console.log(`\n  ${c.bold("Plan:")} ${automatable.length} to automate, ${skipped.length} to skip`);

  // Save gather log with full item data
  const logPath = getGatherLogPath(workDir);
  const gatherLog: GatherLog = {
    timestamp: new Date().toISOString(),
    demo: demoName,
    mode: dryRun ? "dry-run" : gatherOnly ? "gather" : "live",
    items: plans.map(p => ({
      id: p.ticket.id,
      title: p.ticket.title,
      executor: p.executorId,
      decision: p.decision,
      ticket: p.ticket,
      alreadyFixed: p.ticket.fields.alreadyFixed as boolean | undefined,
    })),
  };
  saveGatherLog(logPath, gatherLog);

  if (gatherOnly || dryRun || automatable.length === 0) {
    if (gatherOnly) console.log(`\n  ${c.yellow("Gather-only mode. Stopping.")}`);
    if (automatable.length === 0) console.log(`\n  ${c.dim("Nothing to automate.")}`);
    process.exit(0);
  }

  // ── Step 6: Execute ───────────────────────────────────────────
  banner("Step 6: Executing Workflows");

  let success = 0, failed = 0;

  for (let i = 0; i < automatable.length; i++) {
    const { ticket, executorId } = automatable[i];
    const executor = registry.get(executorId!);
    if (!executor) { failed++; continue; }

    console.log(`\n${c.bold(`[${i + 1}/${automatable.length}] ${ticket.id} -> ${executor.name}`)}`);

    // CQRS: StartWorkflowExecution
    const execId = `wf-exec-${ticket.id}-${Date.now()}`;
    await dispatch(WorkflowExecutionAggregate, execId, new StartWorkflowExecution(
      execId, ticket.id, executorId!, new Date().toISOString()
    ));

    // Default browser context for DRIVE admin operations
    const ctx: WorkflowContext = { browser, skills: skillLoader, workDir, logger, dryRun: false };
    const result = await executor.execute(ticket, ctx);

    // CQRS: Emit step events
    for (const step of result.steps) {
      const stepNow = new Date().toISOString();
      await dispatch(WorkflowExecutionAggregate, execId, new StartStep(execId, step.name, step.detail || "", stepNow));
      if (step.status === "completed") {
        await dispatch(WorkflowExecutionAggregate, execId, new CompleteStep(execId, step.name, step.detail || "", stepNow));
      } else if (step.status === "failed") {
        await dispatch(WorkflowExecutionAggregate, execId, new FailStep(execId, step.name, step.detail || "", stepNow));
      } else if (step.status === "skipped") {
        await dispatch(WorkflowExecutionAggregate, execId, new SkipStep(execId, step.name, step.detail || "", stepNow));
      }
    }

    // CQRS: Complete or fail execution
    if (result.success) {
      await dispatch(WorkflowExecutionAggregate, execId, new CompleteExecution(
        execId, result.summary || "", {}, new Date().toISOString()
      ));
    } else {
      await dispatch(WorkflowExecutionAggregate, execId, new FailExecution(
        execId, result.error || result.summary || "unknown error", new Date().toISOString()
      ));
    }

    // Find this item in the gather log and update it
    const logItem = gatherLog.items.find(item => item.id === ticket.id);
    if (logItem) {
      logItem.processedStatus = result.success ? "success" : "failed";
      logItem.processedAt = new Date().toISOString();
      if (result.ticketComment) logItem.ticketComment = result.ticketComment;
      if (result.commentIsInternal) logItem.commentIsInternal = result.commentIsInternal;
      if (result.error) logItem.error = result.error;
    }

    // Post comment if workflow produced one - use incognito context for ServiceNow
    if (result.ticketComment) {
      // CQRS: PostTicketComment
      await dispatch(TicketAggregate, ticket.id, new PostComment(
        ticket.id, result.ticketComment, !!result.commentIsInternal, new Date().toISOString()
      ));

      const commentFn = servicenowSkill.provider.getCapability("ticket-comment");
      if (commentFn) {
        try {
          // Use incognito context for ServiceNow to avoid SSO conflicts with DRIVE
          const snowContext = await browser.newContext();
          const snowPage = await snowContext.newPage();
          await commentFn(
            { sysId: ticket.fields.sysId, incNumber: ticket.id },
            result.ticketComment,
            { field: result.commentIsInternal ? "work_notes" : "comments", page: snowPage }
          );
          logger.log(`Posted comment on ${ticket.id}`);
          if (logItem) {
            logItem.snowUpdated = true;
            logItem.snowUpdatedAt = new Date().toISOString();
          }
          await snowContext.close();
        } catch (err) {
          logger.warn(`Comment failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // CQRS: ResolveTicket (if successful)
    if (result.success) {
      await dispatch(TicketAggregate, ticket.id, new ResolveTicket(
        ticket.id, result.summary || "Automated resolution", new Date().toISOString()
      ));
    }

    if (result.success) {
      success++;
      console.log(`  ${c.green("OK")} ${result.summary}`);
    } else {
      failed++;
      console.log(`  ${c.red("FAIL")} ${result.error || result.summary}`);
    }

    for (const step of result.steps) {
      const icon = step.status === "completed" ? c.green("v") : step.status === "failed" ? c.red("x") : c.yellow("-");
      console.log(`    ${icon} ${step.name}: ${step.detail}`);
    }

    // Save gather log after EACH item
    saveGatherLog(logPath, gatherLog);
  }

  // ── Event Store Summary ───────────────────────────────────────
  banner("Event Store Summary");

  // Wait briefly for subscriber to process remaining events
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    const statsRepo = new ReadRepository(mapper, dbPool, console);
    const stats = await statsRepo.findOne_v2("ticket_stats", { id: "global" });
    const allExecs = await statsRepo.findAll("workflow_executions");
    const completedExecs = allExecs.filter((e: Record<string, unknown>) => e.status === "completed").length;
    const failedExecs = allExecs.filter((e: Record<string, unknown>) => e.status === "failed").length;
    const lastPos = await eventStore.lastPosition();

    console.log(`  Tickets received:       ${stats?.totalReceived ?? 0}`);
    console.log(`  Tickets analyzed:       ${stats?.totalAnalyzed ?? 0}`);
    console.log(`  Workflows matched:      ${stats?.totalMatched ?? 0}`);
    console.log(`  Tickets escalated:      ${stats?.totalEscalated ?? 0}`);
    console.log(`  Executions completed:   ${completedExecs}`);
    console.log(`  Executions failed:      ${failedExecs}`);
    console.log(`  Tickets resolved:       ${stats?.totalResolved ?? 0}`);
    console.log(`  Events emitted:         ${lastPos?.value ?? 0}`);
  } catch (err) {
    logger.warn(`Could not read event store summary: ${err instanceof Error ? err.message : String(err)}`);
  }

  banner("Complete");
  console.log(`  ${c.green("Success:")} ${success}  ${c.red("Failed:")} ${failed}  ${c.dim("Skipped:")} ${skipped.length}\n`);
}

main().catch(err => {
  console.error(`\nFatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
