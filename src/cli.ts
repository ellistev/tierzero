import "dotenv/config";
import path from "path";
import { KnowledgeIndexer } from "./rag/indexer";
import { KnowledgeRetriever } from "./rag/retriever";
import { ServiceNowConnector } from "./connectors/servicenow";
import { AgentGraph } from "./agent/agent";
import { TicketPoller } from "./agent/poller";

// ---------------------------------------------------------------------------
// ANSI helpers -- minimal, no dependency
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY;
const c = {
  bold:  (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  dim:   (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
  green: (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  red:   (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  yellow:(s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:  (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
};

function hr() { console.log(c.dim("─".repeat(60))); }
function die(msg: string): never {
  console.error(c.red(`\nError: ${msg}\n`));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Argument parser -- no external dep
// ---------------------------------------------------------------------------

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positionals.push(arg);
      i += 1;
    }
  }
  return { positionals, flags };
}

function str(flags: ParsedArgs["flags"], key: string, fallback?: string): string {
  const v = flags[key];
  if (typeof v === "string") return v;
  if (fallback !== undefined) return fallback;
  die(`Missing required option --${key}`);
}

function num(flags: ParsedArgs["flags"], key: string, fallback: number): number {
  const v = flags[key];
  if (typeof v === "string") {
    const n = Number(v);
    if (isNaN(n)) die(`--${key} must be a number, got "${v}"`);
    return n;
  }
  return fallback;
}

function bool(flags: ParsedArgs["flags"], key: string): boolean {
  return flags[key] === true;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
${c.bold("operation-agent-steve")} -- AI ticket resolution agent

${c.bold("Commands:")}

  ${c.cyan("index")}  <knowledge-dir>           Index a folder of documents into ChromaDB
  ${c.cyan("search")} <query>                    Search the knowledge base (test RAG)
  ${c.cyan("run")}    <ticket-id>                Run the agent on a ticket

${c.bold("Global options:")}
  --collection <name>    ChromaDB collection name   ${c.dim("(default: knowledge)")}
  --chroma-url <url>     ChromaDB server URL         ${c.dim("(default: http://localhost:8000)")}

${c.bold("index options:")}
  --chunk-size <n>       Characters per chunk        ${c.dim("(default: 1000)")}
  --chunk-overlap <n>    Overlap between chunks      ${c.dim("(default: 200)")}
  --force                Re-index all files, even unchanged ones
  --stats                Print index stats without re-indexing

${c.bold("search options:")}
  --k <n>                Results to return           ${c.dim("(default: 5)")}
  --threshold <n>        Min similarity score 0-1    ${c.dim("(default: 0.5)")}
  --folder <prefix>      Restrict to source prefix   ${c.dim('e.g. "runbooks/"')}
  --mmr                  Use Maximal Marginal Relevance for diverse results

${c.bold("run options (ServiceNow connector):")}
  --instance-url <url>   Instance URL                ${c.dim("(env: SERVICENOW_INSTANCE_URL)")}
  --username <user>      Username                    ${c.dim("(env: SERVICENOW_USERNAME)")}
  --password <pass>      Password                    ${c.dim("(env: SERVICENOW_PASSWORD)")}
  --table <name>         Table name                  ${c.dim("(default: incident)")}
  --model <name>         LLM model                   ${c.dim("(default: gpt-4o-mini)")}
  --max-iterations <n>   Agent loop cap              ${c.dim("(default: 10)")}
  --dry-run              Log actions without executing them

${c.bold("watch options (continuous polling loop):")}
  --interval <s>         Poll interval in seconds    ${c.dim("(default: 60)")}
  --batch-size <n>       Max tickets per cycle       ${c.dim("(default: 0 = unlimited)")}
  --max-tickets <n>      Stop after N total tickets  ${c.dim("(default: 0 = run forever)")}
  (also accepts all run options above for connector + agent config)
`);
}

// ---------------------------------------------------------------------------
// index command
// ---------------------------------------------------------------------------

async function cmdIndex(args: ParsedArgs) {
  const knowledgeDir = args.positionals[0];
  if (!knowledgeDir) die("Usage: index <knowledge-dir> [options]");

  const absDir = path.resolve(knowledgeDir);
  const collection = str(args.flags, "collection", "knowledge");
  const chromaUrl  = str(args.flags, "chroma-url", "http://localhost:8000");
  const chunkSize  = num(args.flags, "chunk-size", 1000);
  const chunkOverlap = num(args.flags, "chunk-overlap", 200);
  const force      = bool(args.flags, "force");
  const statsOnly  = bool(args.flags, "stats");

  const indexer = new KnowledgeIndexer({
    knowledgeDir: absDir,
    collectionName: collection,
    chromaUrl,
    chunkSize,
    chunkOverlap,
  });

  if (statsOnly) {
    const stats = await indexer.stats();
    console.log(`\n${c.bold("Index stats")}`);
    hr();
    console.log(`Collection : ${c.cyan(collection)}`);
    console.log(`Chroma URL : ${c.dim(chromaUrl)}`);
    console.log(`Total chunks : ${c.bold(String(stats.totalChunks))}`);
    console.log(`Sources      : ${stats.sources.length}`);
    stats.sources.forEach(s => console.log(`  ${c.dim("·")} ${s}`));
    console.log();
    return;
  }

  console.log(`\n${c.bold("Indexing")} ${c.cyan(absDir)}`);
  console.log(`Collection: ${c.cyan(collection)}  Chroma: ${c.dim(chromaUrl)}`);
  if (force) console.log(c.yellow("  --force: re-indexing all files"));
  hr();

  const result = await indexer.index({ force });

  hr();
  console.log(`\n${c.bold("Summary")}`);
  console.log(`  Files processed : ${c.green(String(result.filesProcessed))}`);
  console.log(`  Files skipped   : ${c.dim(String(result.filesSkipped))}  ${c.dim("(unchanged)")}`);
  console.log(`  Chunks added    : ${c.green(String(result.chunksAdded))}`);
  console.log(`  Chunks deleted  : ${c.dim(String(result.chunksDeleted))}  ${c.dim("(re-indexed files)")}`);
  if (result.errors.length) {
    console.log(`  Errors          : ${c.red(String(result.errors.length))}`);
    result.errors.forEach(e => console.log(`    ${c.red("·")} ${e.file}: ${e.error}`));
  } else {
    console.log(`  Errors          : ${c.dim("0")}`);
  }
  console.log(`  Duration        : ${c.dim((result.durationMs / 1000).toFixed(1) + "s")}`);
  console.log();
}

// ---------------------------------------------------------------------------
// search command
// ---------------------------------------------------------------------------

async function cmdSearch(args: ParsedArgs) {
  const query = args.positionals[0];
  if (!query) die("Usage: search <query> [options]");

  const collection = str(args.flags, "collection", "knowledge");
  const chromaUrl  = str(args.flags, "chroma-url", "http://localhost:8000");
  const k          = num(args.flags, "k", 5);
  const threshold  = num(args.flags, "threshold", 0.5);
  const folder     = typeof args.flags["folder"] === "string" ? args.flags["folder"] : undefined;
  const mmr        = bool(args.flags, "mmr");

  const retriever = new KnowledgeRetriever({ collectionName: collection, chromaUrl, k, scoreThreshold: threshold });

  console.log(`\n${c.bold("Search")} ${c.cyan(`"${query}"`)}`);
  console.log(`Collection: ${c.cyan(collection)}  k: ${k}  threshold: ${threshold}${mmr ? "  mode: MMR" : ""}`);
  if (folder) console.log(`Folder filter: ${c.dim(folder)}`);
  hr();

  const result = await retriever.search(query, {
    k,
    scoreThreshold: threshold,
    filter: folder ? { sourcePrefix: folder } : undefined,
    mmr,
  });

  if (result.chunks.length === 0) {
    console.log(c.yellow("\nNo results above threshold. Try lowering --threshold or broadening the query.\n"));
    return;
  }

  console.log(`${c.dim(`Found ${result.totalReturned} of ${result.totalFound} results`)}\n`);

  result.chunks.forEach((chunk, i) => {
    const scoreLabel = isNaN(chunk.score)
      ? c.yellow("MMR")
      : c.green(chunk.score.toFixed(3));

    console.log(`${c.bold(`[${i + 1}]`)} ${c.cyan(chunk.source)}  ${c.dim("score:")} ${scoreLabel}`);

    // Print first ~4 lines of content, truncated to terminal width
    const lines = chunk.content.split("\n").filter(l => l.trim()).slice(0, 4);
    lines.forEach(line => {
      const truncated = line.length > 80 ? line.slice(0, 77) + "..." : line;
      console.log(`    ${c.dim(truncated)}`);
    });
    if (i < result.chunks.length - 1) console.log();
  });

  console.log();
}

// ---------------------------------------------------------------------------
// run command
// ---------------------------------------------------------------------------

async function cmdRun(args: ParsedArgs) {
  const ticketId = args.positionals[0];
  if (!ticketId) die("Usage: run <ticket-id> [options]");

  const instanceUrl = str(args.flags, "instance-url", process.env.SERVICENOW_INSTANCE_URL ?? "");
  const username    = str(args.flags, "username",     process.env.SERVICENOW_USERNAME ?? "");
  const password    = str(args.flags, "password",     process.env.SERVICENOW_PASSWORD ?? "");
  const table       = str(args.flags, "table",        "incident");
  const collection  = str(args.flags, "collection",   "knowledge");
  const chromaUrl   = str(args.flags, "chroma-url",   "http://localhost:8000");
  const model       = str(args.flags, "model",        "gpt-4o-mini");
  const maxIter     = num(args.flags, "max-iterations", 10);
  const dryRun      = bool(args.flags, "dry-run");

  if (!instanceUrl) die("ServiceNow instance URL required. Pass --instance-url or set SERVICENOW_INSTANCE_URL.");
  if (!username)    die("ServiceNow username required. Pass --username or set SERVICENOW_USERNAME.");
  if (!password)    die("ServiceNow password required. Pass --password or set SERVICENOW_PASSWORD.");

  const connector = new ServiceNowConnector({ instanceUrl, username, password, table });
  const retriever = new KnowledgeRetriever({ collectionName: collection, chromaUrl });

  console.log(`\n${c.bold("Fetching ticket")} ${c.cyan(ticketId)} ${c.dim(`from ${instanceUrl}`)}`);

  const ticket = await connector.getTicket(ticketId);

  console.log(`\n${c.bold(ticket.title)}`);
  console.log(`${c.dim("Status:")} ${ticket.status}  ${c.dim("Priority:")} ${ticket.priority}  ${c.dim("Type:")} ${ticket.type}`);
  console.log(`${c.dim("Reporter:")} ${ticket.reporter.name}${ticket.assignee ? `  ${c.dim("Assignee:")} ${ticket.assignee.name}` : ""}`);
  if (ticket.url) console.log(`${c.dim("URL:")} ${ticket.url}`);
  hr();

  const agent = new AgentGraph({
    deps: { connector, retriever },
    model,
    maxIterations: maxIter,
    dryRun,
  });

  if (dryRun) console.log(c.yellow("  --dry-run: actions will be logged but not executed\n"));

  console.log(`${c.bold("Running agent")}  model: ${c.dim(model)}  max-iterations: ${c.dim(String(maxIter))}\n`);

  try {
    const finalState = await agent.run(ticket);

    hr();
    console.log(`\n${c.bold("Result")}`);
    console.log(`  Decision  : ${c.cyan(finalState.decision ?? "none")}`);
    console.log(`  Confidence: ${finalState.confidence.toFixed(2)}`);
    if (finalState.actionTaken) {
      console.log(`  Action    : ${c.green(finalState.actionTaken.type)}`);
    }
    if (finalState.error) {
      console.log(`  Error     : ${c.red(finalState.error)}`);
    }

    if (finalState.steps.length) {
      console.log(`\n${c.bold("Steps")}`);
      finalState.steps.forEach((step, i) => {
        console.log(`  ${c.dim(`${i + 1}.`)} ${c.bold(step.node)}  ${c.dim(step.summary)}`);
      });
    }
    console.log();
  } catch (err) {
    // AgentGraph.run() throws until the StateGraph is wired -- show clearly
    const msg = err instanceof Error ? err.message : String(err);
    console.error(c.yellow(`\n  Agent not yet fully implemented: ${msg}\n`));
    console.error(c.dim("  Wire up the LangGraph StateGraph in src/agent/agent.ts to proceed.\n"));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// watch command
// ---------------------------------------------------------------------------

async function cmdWatch(args: ParsedArgs) {
  const instanceUrl = str(args.flags, "instance-url", process.env.SERVICENOW_INSTANCE_URL ?? "");
  const username    = str(args.flags, "username",     process.env.SERVICENOW_USERNAME ?? "");
  const password    = str(args.flags, "password",     process.env.SERVICENOW_PASSWORD ?? "");
  const table       = str(args.flags, "table",        "incident");
  const collection  = str(args.flags, "collection",   "knowledge");
  const chromaUrl   = str(args.flags, "chroma-url",   "http://localhost:8000");
  const model       = str(args.flags, "model",        "gpt-4o-mini");
  const maxIter     = num(args.flags, "max-iterations", 10);
  const dryRun      = bool(args.flags, "dry-run");
  const intervalSec = num(args.flags, "interval",     60);
  const batchSize   = num(args.flags, "batch-size",   0);
  const maxTickets  = num(args.flags, "max-tickets",  0);

  if (!instanceUrl) die("ServiceNow instance URL required. Pass --instance-url or set SERVICENOW_INSTANCE_URL.");
  if (!username)    die("ServiceNow username required. Pass --username or set SERVICENOW_USERNAME.");
  if (!password)    die("ServiceNow password required. Pass --password or set SERVICENOW_PASSWORD.");

  const connector = new ServiceNowConnector({ instanceUrl, username, password, table });
  const retriever = new KnowledgeRetriever({ collectionName: collection, chromaUrl });
  const agent = new AgentGraph({ deps: { connector, retriever }, model, maxIterations: maxIter, dryRun });

  let totalProcessed = 0;

  const poller = new TicketPoller({
    connector,
    agent,
    batchSize,
    onTicketStart: (ticket) => {
      console.log(`\n  ${c.bold("→")} ${c.cyan(ticket.externalId ?? ticket.id)}  ${ticket.title}`);
    },
    onTicketDone: (ticket, state) => {
      const action = state.actionTaken?.type ?? "no_action";
      console.log(`    ${c.green("✓")} ${state.decision ?? "none"} (${state.confidence.toFixed(2)})  action: ${c.dim(action)}`);
      totalProcessed++;
      if (maxTickets > 0 && totalProcessed >= maxTickets) {
        console.log(c.yellow(`\nMax tickets (${maxTickets}) reached. Stopping.\n`));
        poller.stop();
        process.exit(0);
      }
    },
    onTicketError: (ticket, err) => {
      console.error(`    ${c.red("✗")} ${ticket.externalId ?? ticket.id}: ${err}`);
    },
    onCycleDone: (result) => {
      if (result.ticketsFound === 0) {
        console.log(c.dim(`  [${new Date().toLocaleTimeString()}] No new open tickets`));
      } else {
        console.log(c.dim(`  [${new Date().toLocaleTimeString()}] Cycle done — processed ${result.ticketsProcessed}/${result.ticketsFound}, errors: ${result.errors.length}`));
      }
    },
  });

  const intervalMs = intervalSec * 1000;
  console.log(`\n${c.bold("Watching")} for open tickets  interval: ${c.dim(intervalSec + "s")}${batchSize ? `  batch: ${batchSize}` : ""}${maxTickets ? `  max: ${maxTickets}` : ""}${dryRun ? `  ${c.yellow("[dry-run]")}` : ""}`);
  console.log(c.dim("Press Ctrl+C to stop.\n"));
  hr();

  poller.start(intervalMs);

  process.on("SIGINT", () => {
    poller.stop();
    console.log(`\n\nStopped. Processed ${totalProcessed} ticket(s) total.\n`);
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  switch (command) {
    case "index":  await cmdIndex(args);  break;
    case "search": await cmdSearch(args); break;
    case "run":    await cmdRun(args);    break;
    case "watch":  await cmdWatch(args);  break;
    default:
      printHelp();
      if (command && command !== "--help" && command !== "-h") process.exit(1);
  }
}

main().catch(err => {
  console.error(c.red(`\nFatal: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
