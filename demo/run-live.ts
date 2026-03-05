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
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { SkillLoader } from "../src/skills/loader";
import { WorkflowRegistry } from "../src/workflows/registry";
import { connectChrome } from "../src/browser/connection";
import type { WorkflowLogger, WorkflowContext, Ticket } from "../src/workflows/types";
import { EventStore, createCommandHandler, ReadModelBuilder } from "../src/infra";
import { ticketEventFactories } from "../src/domain/ticket/events";
import { workflowExecutionEventFactories } from "../src/domain/workflow-execution/events";
import { ticketsReadModel } from "../src/read-models/tickets";
import { workflowExecutionsReadModel } from "../src/read-models/workflow-executions";
import { ticketStatsReadModel } from "../src/read-models/ticket-stats";

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
  // For demo config, we just need key-value pairs and nested objects
  // Use a real YAML parser in production
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

      // Resolve env var references
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const gatherOnly = args.includes("--gather-only");
  const demoIdx = args.indexOf("--demo");
  const demoName = demoIdx >= 0 ? args[demoIdx + 1] : null;

  if (!demoName) {
    console.error("Usage: tsx demo/run-live.ts --demo <name> [--dry-run] [--gather-only]");
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

  // Load env section from config
  const configRaw = fs.readFileSync(configPath, "utf-8");
  const config = parseSimpleYaml(configRaw);

  // Apply env defaults from config
  if (config.env && typeof config.env === "object") {
    for (const [key, value] of Object.entries(config.env as Record<string, string>)) {
      if (!process.env[key]) process.env[key] = value;
    }
  }

  const workDir = path.join(demoDir, "json-payloads");
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  // ── CQRS/ES Infrastructure ──────────────────────────────────
  const allEventFactories: Record<string, (d: Record<string, unknown>) => unknown> = {
    ...ticketEventFactories,
    ...workflowExecutionEventFactories,
  };
  const eventFactory = (type: string, data: Record<string, unknown>) => {
    const factory = allEventFactories[type];
    if (!factory) throw new Error(`Unknown event type: ${type}`);
    return factory(data);
  };

  const eventStoreDbPath = path.join(demoDir, "event-store.db");
  const eventStore = new EventStore(eventStoreDbPath);
  const cqrsCommandHandler = createCommandHandler(eventStore, eventFactory);

  const readModelBuilder = new ReadModelBuilder(path.join(demoDir, "read-models.db"));
  readModelBuilder.register(ticketsReadModel);
  readModelBuilder.register(workflowExecutionsReadModel);
  readModelBuilder.register(ticketStatsReadModel);
  readModelBuilder.catchUp(eventStore);
  readModelBuilder.subscribeTo(eventStore);

  banner(`TierZero LIVE - ${(config as Record<string, unknown>).name || demoName}`);
  console.log(`  ${c.bold("Demo:")}  ${demoName} (${demoDir})`);
  console.log(`  ${c.bold("Mode:")}  ${dryRun ? c.yellow("DRY RUN") : gatherOnly ? c.yellow("GATHER ONLY") : c.green("LIVE EXECUTION")}`);

  // ── Step 1: Load Skills ───────────────────────────────────────
  banner("Step 1: Loading Skills");

  const skillConfig = (config.skills as Record<string, Record<string, unknown>>) ?? {};

  const skillLoader = new SkillLoader({
    skillDirs: [
      path.join(projectRoot, "skills"),        // Bundled skills
      path.join(demoDir, "skills"),             // Demo-specific skills
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

  // Read details
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
  }

  const automatable = plans.filter(p => p.decision === "execute" && p.executorId);
  const skipped = plans.filter(p => p.decision !== "execute" || !p.executorId);

  console.log(`\n  ${c.bold("Plan:")} ${automatable.length} to automate, ${skipped.length} to skip`);

  // Save gather log
  const logPath = path.join(workDir, `tierzero-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(logPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    demo: demoName,
    mode: dryRun ? "dry-run" : gatherOnly ? "gather" : "live",
    plans: plans.map(p => ({ id: p.ticket.id, title: p.ticket.title, executor: p.executorId, decision: p.decision })),
  }, null, 2));

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

    const ctx: WorkflowContext = { browser, skills: skillLoader, workDir, logger, dryRun: false, commandHandler: cqrsCommandHandler };
    const result = await executor.execute(ticket, ctx);

    // Post comment if workflow produced one
    if (result.ticketComment) {
      const commentFn = servicenowSkill.provider.getCapability("ticket-comment");
      if (commentFn) {
        try {
          await commentFn(
            { sysId: ticket.fields.sysId, incNumber: ticket.id },
            result.ticketComment,
            { field: result.commentIsInternal ? "work_notes" : "comments" }
          );
          logger.log(`Posted comment on ${ticket.id}`);
        } catch (err) {
          logger.warn(`Comment failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
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
  }

  banner("Complete");
  console.log(`  ${c.green("Success:")} ${success}  ${c.red("Failed:")} ${failed}  ${c.dim("Skipped:")} ${skipped.length}\n`);
}

main().catch(err => {
  console.error(`\nFatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
