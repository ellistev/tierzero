import "dotenv/config";
import path from "path";
import { KnowledgeIndexer } from "./rag/indexer";
import { KnowledgeRetriever } from "./rag/retriever";
import { ServiceNowConnector } from "./connectors/servicenow";
import { JiraConnector } from "./connectors/jira";
import { GitLabConnector } from "./connectors/gitlab";
import { FreshdeskConnector } from "./connectors/freshdesk";
import { AgentGraph } from "./agent/agent";
import { TicketPoller } from "./agent/poller";
import { AzureDevOpsWikiImporter, AzureDevOpsWorkItemMiner } from "./ingest/azure-devops";
import { ConfluenceImporter } from "./ingest/confluence";
import { UrlScraper } from "./ingest/url-scraper";
import { TicketMiner } from "./ingest/ticket-miner";
import type { IngestResult } from "./ingest/types";
import { createCodingModel, inferProvider } from "./coder/providers";
import type { CodebaseConfig, CodingProvider } from "./coder/types";
import { GitHubWatcher } from "./workflows/github-watcher";
import { spawnStreaming } from "./workflows/issue-pipeline";
import type { CodeAgent, IssueContext, CodeAgentResult } from "./workflows/issue-pipeline";

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
  ${c.cyan("watch")}                             Continuous polling loop for ServiceNow tickets
  ${c.cyan("watch-github")}                      Watch a GitHub repo and autonomously resolve issues
  ${c.cyan("import-wiki")}                       Import docs from Azure DevOps or Confluence
  ${c.cyan("mine-tickets")}                      Mine resolved tickets from ServiceNow/Jira/GitLab/Freshdesk
  ${c.cyan("import-url")} <urls...>              Scrape one or more URLs into the knowledge base

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

${c.bold("code implementation options (run / watch):")}
  --codebase <path>      Path to repo the agent can code in
  --codebase-name <n>    Name for the codebase       ${c.dim("(default: folder name)")}
  --test-command <cmd>   Test command to run after edits ${c.dim("(e.g. 'npm test')")}
  --branch-prefix <p>    Git branch prefix           ${c.dim("(default: tierzero/)")}
  --coding-model <name>  Coding LLM model            ${c.dim("(e.g. claude-sonnet-4-20250514, gpt-4o)")}
  --coding-provider <p>  Force provider              ${c.dim("(openai, anthropic, google — auto-detected)")}
  --coding-api-key <k>   API key for coding LLM      ${c.dim("(falls back to provider env var)")}

${c.bold("watch options (continuous polling loop):")}
  --interval <s>         Poll interval in seconds    ${c.dim("(default: 60)")}
  --batch-size <n>       Max tickets per cycle       ${c.dim("(default: 0 = unlimited)")}
  --max-tickets <n>      Stop after N total tickets  ${c.dim("(default: 0 = run forever)")}
  (also accepts all run options above for connector + agent config)

${c.bold("import-wiki options:")}
  --source <src>         "azuredevops" or "confluence"
  Azure DevOps:
    --org <name>         AzDO organization name      ${c.dim("(env: AZUREDEVOPS_ORG)")}
    --project <name>     AzDO project name           ${c.dim("(env: AZUREDEVOPS_PROJECT)")}
    --token <pat>        Personal Access Token       ${c.dim("(env: AZUREDEVOPS_TOKEN)")}
    --wiki-id <id>       Specific wiki ID (optional)
    --mode wiki|workitems|both  What to import       ${c.dim("(default: both)")}
    --limit <n>          Max work items to mine      ${c.dim("(default: 100)")}
  Confluence:
    --base-url <url>     Confluence base URL         ${c.dim("(env: CONFLUENCE_BASE_URL)")}
    --email <email>      Atlassian account email     ${c.dim("(env: CONFLUENCE_EMAIL)")}
    --api-token <token>  API token                   ${c.dim("(env: CONFLUENCE_API_TOKEN)")}
    --space-key <key>    Space key(s), comma-separated ${c.dim("(default: all spaces)")}
  Shared:
    --output <dir>       Output root directory       ${c.dim("(default: knowledge)")}

${c.bold("mine-tickets options:")}
  --connector <name>     "servicenow", "jira", "gitlab", or "freshdesk"
  ServiceNow: --instance-url --username --password
  Jira:       --base-url --email --api-token --project-key
  GitLab:     --base-url --token --project-id
  Freshdesk:  --domain --api-key
  --limit <n>            Max tickets to mine         ${c.dim("(default: 100)")}
  --min-comments <n>     Quality gate                ${c.dim("(default: 1)")}
  --since <ISO date>     Only tickets updated after this date
  --output <dir>         Output root directory       ${c.dim("(default: knowledge)")}

${c.bold("watch-github options:")}
  --owner <name>         GitHub owner (org or user)  ${c.dim("(required)")}
  --repo <name>          GitHub repository name      ${c.dim("(required)")}
  --token <token>        GitHub personal access token ${c.dim("(env: GITHUB_TOKEN)")}
  --interval <s>         Poll interval in seconds    ${c.dim("(default: 60)")}
  --label <name>         Trigger label on issues     ${c.dim("(default: tierzero-agent)")}
  --assign-to <user>     Assign issues to this user  ${c.dim("(optional)")}
  --workdir <path>       Working directory / repo    ${c.dim("(default: cwd)")}
  --test-command <cmd>   Test command after edits    ${c.dim("(default: npm test)")}

${c.bold("import-url options:")}
  <urls...>              One or more URLs to scrape
  --output <dir>         Output root directory       ${c.dim("(default: knowledge)")}
  --ignore-robots        Skip robots.txt check
  --timeout <ms>         Fetch timeout               ${c.dim("(default: 15000)")}
`);
}

// ---------------------------------------------------------------------------
// Coder config helper (shared by run + watch)
// ---------------------------------------------------------------------------

function buildCoderConfig(flags: ParsedArgs["flags"]): { codebases: CodebaseConfig[]; codingModel: ReturnType<typeof createCodingModel> | undefined } {
  const codebasePath = typeof flags["codebase"] === "string" ? flags["codebase"] : undefined;
  if (!codebasePath) return { codebases: [], codingModel: undefined };

  const absPath = path.resolve(codebasePath);
  const codebaseName = str(flags, "codebase-name", path.basename(absPath));
  const testCommand = typeof flags["test-command"] === "string" ? flags["test-command"] : undefined;
  const branchPrefix = str(flags, "branch-prefix", "tierzero/");

  const codebase: CodebaseConfig = {
    name: codebaseName,
    path: absPath,
    testCommand,
    branchPrefix,
  };

  const codingModelName = str(flags, "coding-model", "");
  if (!codingModelName) die("--coding-model required when --codebase is set (e.g. claude-sonnet-4-20250514, gpt-4o)");

  const providerStr = typeof flags["coding-provider"] === "string" ? flags["coding-provider"] : undefined;
  const provider = (providerStr ?? inferProvider(codingModelName)) as CodingProvider | undefined;
  if (!provider) die(`Cannot infer provider for model "${codingModelName}". Pass --coding-provider explicitly.`);

  const apiKey = typeof flags["coding-api-key"] === "string" ? flags["coding-api-key"] : undefined;

  const codingModel = createCodingModel({
    provider,
    model: codingModelName,
    apiKey,
  });

  return { codebases: [codebase], codingModel };
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

  const { codebases, codingModel } = buildCoderConfig(args.flags);

  const agent = new AgentGraph({
    deps: { connector, retriever },
    model,
    maxIterations: maxIter,
    dryRun,
    codebases,
    codingModel: codingModel as any,
  });

  if (dryRun) console.log(c.yellow("  --dry-run: actions will be logged but not executed\n"));
  if (codebases.length) console.log(`${c.bold("Codebase:")} ${c.cyan(codebases[0].name)} (${codebases[0].path})  coding model: ${c.dim(codingModel?.modelName ?? "none")}`);

  console.log(`${c.bold("Running agent")}  model: ${c.dim(model)}  max-iterations: ${c.dim(String(maxIter))}\n`);

  try {
    const finalState = await agent.run(ticket);

    hr();
    console.log(`\n${c.bold("Result")}`);
    console.log(`  Decision  : ${c.cyan(finalState.decision ?? "none")}`);
    console.log(`  Confidence: ${finalState.confidence.toFixed(2)}`);
    if (finalState.actionTaken) {
      console.log(`  Action    : ${c.green(finalState.actionTaken.type)}`);
      if (finalState.actionTaken.type === "implemented") {
        const impl = finalState.actionTaken;
        if (impl.branch) console.log(`  Branch    : ${c.cyan(impl.branch)}`);
        if (impl.commitHash) console.log(`  Commit    : ${c.dim(impl.commitHash)}`);
        if (impl.testsPassed !== undefined) console.log(`  Tests     : ${impl.testsPassed ? c.green("passed") : c.red("failed")}`);
      }
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
  const { codebases, codingModel } = buildCoderConfig(args.flags);
  const agent = new AgentGraph({ deps: { connector, retriever }, model, maxIterations: maxIter, dryRun, codebases, codingModel: codingModel as any });

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
// Shared ingest result printer
// ---------------------------------------------------------------------------

function printIngestResult(result: IngestResult, label: string) {
  hr();
  console.log(`\n${c.bold(label)}`);
  console.log(`  Imported  : ${c.green(String(result.imported))}`);
  console.log(`  Skipped   : ${c.dim(String(result.skipped))}  ${c.dim("(unchanged)")}`);
  if (result.errors.length) {
    console.log(`  Errors    : ${c.red(String(result.errors.length))}`);
    result.errors.forEach((e) => console.log(`    ${c.red("·")} ${e.source}: ${e.error}`));
  } else {
    console.log(`  Errors    : ${c.dim("0")}`);
  }
  console.log(`  Duration  : ${c.dim((result.durationMs / 1000).toFixed(1) + "s")}`);
  if (result.docs.length) {
    console.log(`\n${c.bold("Files written:")}`);
    result.docs.forEach((d) =>
      console.log(`  ${c.dim("·")} ${c.cyan(d.filename)}  ${c.dim(`(${d.wordCount} words)`)}`)
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// import-wiki command
// ---------------------------------------------------------------------------

async function cmdImportWiki(args: ParsedArgs) {
  const source = str(args.flags, "source", "");
  if (!source) die('--source required: "azuredevops" or "confluence"');

  const outputDir = str(args.flags, "output", "knowledge");

  if (source === "azuredevops") {
    const org     = str(args.flags, "org",     process.env.AZUREDEVOPS_ORG     ?? "");
    const project = str(args.flags, "project", process.env.AZUREDEVOPS_PROJECT ?? "");
    const token   = str(args.flags, "token",   process.env.AZUREDEVOPS_TOKEN   ?? "");
    const wikiId  = typeof args.flags["wiki-id"] === "string" ? args.flags["wiki-id"] : undefined;
    const mode    = str(args.flags, "mode", "both");
    const limit   = num(args.flags, "limit", 100);

    if (!org)     die("Azure DevOps organization required. Pass --org or set AZUREDEVOPS_ORG.");
    if (!project) die("Azure DevOps project required. Pass --project or set AZUREDEVOPS_PROJECT.");
    if (!token)   die("Azure DevOps token required. Pass --token or set AZUREDEVOPS_TOKEN.");

    const cfg = { organization: org, project, token, wikiId, outputDir };

    if (mode === "wiki" || mode === "both") {
      console.log(`\n${c.bold("Importing Azure DevOps Wiki")}  org: ${c.cyan(org)}  project: ${c.cyan(project)}`);
      const importer = new AzureDevOpsWikiImporter(cfg);
      const result = await importer.import();
      printIngestResult(result, "Wiki Import Summary");
    }

    if (mode === "workitems" || mode === "both") {
      console.log(`\n${c.bold("Mining Azure DevOps Work Items")}  limit: ${c.dim(String(limit))}`);
      const miner = new AzureDevOpsWorkItemMiner({ ...cfg, limit });
      const result = await miner.mine();
      printIngestResult(result, "Work Item Mining Summary");
    }

  } else if (source === "confluence") {
    const baseUrl  = str(args.flags, "base-url",  process.env.CONFLUENCE_BASE_URL  ?? "");
    const email    = str(args.flags, "email",     process.env.CONFLUENCE_EMAIL      ?? "");
    const apiToken = str(args.flags, "api-token", process.env.CONFLUENCE_API_TOKEN  ?? "");
    const spaceKeysRaw = typeof args.flags["space-key"] === "string" ? args.flags["space-key"] : "";
    const spaceKeys = spaceKeysRaw ? spaceKeysRaw.split(",").map((k) => k.trim()) : [];

    if (!baseUrl)  die("Confluence base URL required. Pass --base-url or set CONFLUENCE_BASE_URL.");
    if (!email)    die("Confluence email required. Pass --email or set CONFLUENCE_EMAIL.");
    if (!apiToken) die("Confluence API token required. Pass --api-token or set CONFLUENCE_API_TOKEN.");

    console.log(`\n${c.bold("Importing Confluence")}  ${c.cyan(baseUrl)}${spaceKeys.length ? `  spaces: ${spaceKeys.join(", ")}` : "  (all spaces)"}`);
    const importer = new ConfluenceImporter({ baseUrl, email, apiToken, spaceKeys, outputDir });
    const result = await importer.import();
    printIngestResult(result, "Confluence Import Summary");

  } else {
    die(`Unknown --source "${source}". Use "azuredevops" or "confluence".`);
  }
}

// ---------------------------------------------------------------------------
// mine-tickets command
// ---------------------------------------------------------------------------

async function cmdMineTickets(args: ParsedArgs) {
  const connectorName = str(args.flags, "connector", "");
  if (!connectorName) die('--connector required: "servicenow", "jira", "gitlab", or "freshdesk"');

  const outputDir    = str(args.flags, "output", "knowledge");
  const limit        = num(args.flags, "limit", 100);
  const minComments  = num(args.flags, "min-comments", 1);
  const sinceStr     = typeof args.flags["since"] === "string" ? args.flags["since"] : undefined;
  const since        = sinceStr ? new Date(sinceStr) : undefined;

  let connector;

  if (connectorName === "servicenow") {
    const instanceUrl = str(args.flags, "instance-url", process.env.SERVICENOW_INSTANCE_URL ?? "");
    const username    = str(args.flags, "username",     process.env.SERVICENOW_USERNAME     ?? "");
    const password    = str(args.flags, "password",     process.env.SERVICENOW_PASSWORD     ?? "");
    if (!instanceUrl) die("ServiceNow instance URL required.");
    if (!username)    die("ServiceNow username required.");
    if (!password)    die("ServiceNow password required.");
    connector = new ServiceNowConnector({ instanceUrl, username, password });

  } else if (connectorName === "jira") {
    const baseUrl    = str(args.flags, "base-url",    process.env.JIRA_BASE_URL    ?? "");
    const email      = str(args.flags, "email",       process.env.JIRA_EMAIL       ?? "");
    const apiToken   = str(args.flags, "api-token",   process.env.JIRA_API_TOKEN   ?? "");
    const projectKey = str(args.flags, "project-key", process.env.JIRA_PROJECT_KEY ?? "");
    if (!baseUrl)    die("Jira base URL required.");
    if (!email)      die("Jira email required.");
    if (!apiToken)   die("Jira API token required.");
    connector = new JiraConnector({ baseUrl, email, apiToken, projectKey });

  } else if (connectorName === "gitlab") {
    const baseUrl   = str(args.flags, "base-url",   process.env.GITLAB_BASE_URL   ?? "https://gitlab.com");
    const token     = str(args.flags, "token",      process.env.GITLAB_TOKEN       ?? "");
    const projectId = str(args.flags, "project-id", process.env.GITLAB_PROJECT_ID  ?? "");
    if (!token)     die("GitLab token required.");
    if (!projectId) die("GitLab project ID required.");
    connector = new GitLabConnector({ baseUrl, token, projectId });

  } else if (connectorName === "freshdesk") {
    const domain = str(args.flags, "domain", process.env.FRESHDESK_DOMAIN ?? "");
    const apiKey = str(args.flags, "api-key", process.env.FRESHDESK_API_KEY ?? "");
    if (!domain) die("Freshdesk domain required. Pass --domain or set FRESHDESK_DOMAIN.");
    if (!apiKey) die("Freshdesk API key required. Pass --api-key or set FRESHDESK_API_KEY.");
    connector = new FreshdeskConnector({ domain, apiKey });

  } else {
    die(`Unknown --connector "${connectorName}". Use "servicenow", "jira", "gitlab", or "freshdesk".`);
  }

  console.log(`\n${c.bold("Mining tickets")}  connector: ${c.cyan(connectorName)}  limit: ${c.dim(String(limit))}  min-comments: ${c.dim(String(minComments))}${since ? `  since: ${since.toISOString()}` : ""}`);

  const miner = new TicketMiner(connector, { outputDir, limit, minComments, since });
  const result = await miner.mine();
  printIngestResult(result, "Ticket Mining Summary");
}

// ---------------------------------------------------------------------------
// import-url command
// ---------------------------------------------------------------------------

async function cmdImportUrl(args: ParsedArgs) {
  const urls = args.positionals;
  if (!urls.length) die("Usage: import-url <url1> [url2 ...] [options]");

  const outputDir     = str(args.flags, "output", "knowledge");
  const ignoreRobots  = bool(args.flags, "ignore-robots");
  const timeoutMs     = num(args.flags, "timeout", 15_000);

  console.log(`\n${c.bold("Scraping URLs")}  count: ${c.cyan(String(urls.length))}${ignoreRobots ? c.yellow("  --ignore-robots") : ""}`);
  urls.forEach((u) => console.log(`  ${c.dim("·")} ${u}`));

  const scraper = new UrlScraper({ outputDir, respectRobots: !ignoreRobots, timeoutMs });
  const result = await scraper.scrape(urls);
  printIngestResult(result, "URL Scrape Summary");
}

// ---------------------------------------------------------------------------
// watch-github: Autonomous GitHub issue watcher
// ---------------------------------------------------------------------------

async function cmdWatchGitHub(args: ParsedArgs) {
  // Imports at top of file

  const owner = str(args.flags, "owner");
  const repo  = str(args.flags, "repo");
  const token = str(args.flags, "token", process.env.GITHUB_TOKEN ?? "");
  const interval = num(args.flags, "interval", 60);
  const label = str(args.flags, "label", "tierzero-agent");
  const assignTo = typeof args.flags["assign-to"] === "string" ? args.flags["assign-to"] : undefined;
  const workDir = str(args.flags, "workdir", process.cwd());
  const testCmd = typeof args.flags["test-command"] === "string" ? args.flags["test-command"] : "npm test";

  if (!token) die("--token or GITHUB_TOKEN env var required");

  // Parse coder config (automatically uses --coding-model, --coding-provider, etc)
  // Force fake codebase so buildCoderConfig parses the coding model args without exploding
  if (!args.flags["codebase"]) {
    args.flags["codebase"] = workDir;
  }
  let { codebases, codingModel } = buildCoderConfig(args.flags);
  
  if (!codingModel || codebases.length === 0) {
    console.log(c.yellow("No --coding-model specified. Defaulting to OpenRouter (claude-3.7-sonnet-20250219)..."));
    // Default to the native implementer with Sonnet 3.7
    codingModel = createCodingModel({ provider: "openrouter" as any, model: "anthropic/claude-3.7-sonnet" });
    codebases = [{
      name: "tierzero",
      path: workDir,
      testCommand: testCmd,
      branchPrefix: "tierzero/",
    }];
  }

  // Native CodeAgent wrapper around Implementer
  const codeAgent: CodeAgent = {
    async solve(issue, wd) {
      if (!codingModel) throw new Error("No coding model");
      const { Implementer } = await import("./coder/implementer");
      const implementer = new Implementer(codebases[0], codingModel);
      
      console.log(c.dim(`\n── Implementer (${codingModel.modelName}) (solve #${issue.number}) ──`));
      
      // Adapt IssueContext to Ticket interface for Implementer
      const dummyTicket: any = {
        id: String(issue.number),
        externalId: String(issue.number),
        title: issue.title,
        description: issue.description + "\n\nComments:\n" + issue.comments.join("\n"),
        type: "task",
        status: "open",
        priority: "medium",
        reporter: { id: "1", name: "github" },
        createdAt: new Date(),
        updatedAt: new Date(),
        source: "github",
        tags: issue.labels,
      };

      const result = await implementer.implement(dummyTicket);
      
      console.log(c.dim(`── end Implementer (${result.success ? "success" : "failed"}) ──\n`));

      return {
        summary: result.summary + (result.error ? `\n\nError: ${result.error}` : ""),
        filesChanged: [...result.filesChanged, ...result.filesDeleted],
      };
    },

    async fixTests(failures, wd) {
      return {
        summary: "Native implementer does not yet support multi-round test fixing for GitHub issues. Review manually.",
        filesChanged: [],
      };
    },
  };

  console.log(`\n${c.bold("TierZero GitHub Watcher")}`);
  console.log(`  ${c.dim("repo:")} ${owner}/${repo}`);
  console.log(`  ${c.dim("label:")} ${label}`);
  console.log(`  ${c.dim("interval:")} ${interval}s`);
  console.log(`  ${c.dim("workdir:")} ${workDir}`);
  if (assignTo) console.log(`  ${c.dim("assign:")} ${assignTo}`);
  hr();

  const watcher = new GitHubWatcher({
    github: { token, owner, repo },
    workDir,
    pollIntervalMs: interval * 1000,
    triggerLabel: label,
    assignTo,
    codeAgent,
    testCommand: testCmd,
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log(c.yellow("\nShutting down..."));
    watcher.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  watcher.start();
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  switch (command) {
    case "index":        await cmdIndex(args);        break;
    case "search":       await cmdSearch(args);       break;
    case "run":          await cmdRun(args);          break;
    case "watch":        await cmdWatch(args);        break;
    case "import-wiki":  await cmdImportWiki(args);  break;
    case "mine-tickets": await cmdMineTickets(args); break;
    case "import-url":   await cmdImportUrl(args);   break;
    case "watch-github": await cmdWatchGitHub(args); break;
    default:
      printHelp();
      if (command && command !== "--help" && command !== "-h") process.exit(1);
  }
}

main().catch(err => {
  console.error(c.red(`\nFatal: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(1);
});
