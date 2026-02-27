# TierZero

AI-powered IT ticket resolution. Reads tickets, searches your runbooks, resolves or escalates -- no human in the loop.

> **Tier 0** is the support level below Tier 1. Fully automated. No queue. No waiting.

Built with **LangGraph** + **LangChain** + **ChromaDB** + **OpenAI**.

---

## Why

Your L1 team spends 70% of their time on tickets that already have a documented fix. Password resets, VPN issues, disk cleanup -- the runbook exists, someone just has to read it and follow the steps.

TierZero does that automatically:
1. Reads the ticket from ServiceNow, Jira, or GitLab
2. Searches your knowledge base for the relevant procedure
3. Either resolves it, asks a clarifying question, or escalates with full context

Every action is auditable. Every decision includes reasoning. Confidence below threshold = automatic escalation to a human. The agent knows what it doesn't know.

---

## How it works

```
Ticket arrives (ServiceNow / Jira / GitLab)
     |
     v
[ingest]    Load full comment thread from connector
     |
     v
[retrieve]  RAG search the knowledge/ folder (MMR, top-K chunks)
     |
     v
[decide]    Structured LLM call -> decision + reasoning + confidence score
     |
     |-- automate       -> post resolution, mark resolved
     |-- draft_response -> post helpful reply, wait for confirmation
     |-- escalate       -> internal note with full context, reassign to human
     '-- needs_info     -> ask reporter one specific clarifying question
     |
     v
[record]    Internal audit note: decision, KB sources, step log
```

**No open-ended tool loops.** The agent plans once (structured output with confidence score) then executes deterministically. Every run leaves a traceable internal note.

---

## Quick start

```bash
# Start ChromaDB
docker run -p 8000:8000 chromadb/chroma

# Install
npm install

# Configure
cp .env.example .env   # add your OPENAI_API_KEY

# Index your runbooks
npm run index -- knowledge/

# Test retrieval
npm run dev -- search "password reset procedure"

# Run on a real ticket (dry run)
npm run run-agent -- INC0012345 \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --dry-run
```

---

## Connectors

TierZero ships with three connectors. Each implements the same `TicketConnector` interface -- swap between them with a flag.

### ServiceNow

```bash
npm run run-agent -- INC0012345 \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret
```

Full Table API adapter: incidents, comments (public + work notes), attachments, status updates, assignment. Supports custom tables via `--table`.

### Jira

```bash
npm run run-agent -- PROJ-1234 \
  --connector jira \
  --base-url https://myco.atlassian.net \
  --email agent@myco.com \
  --api-token secret \
  --project-key PROJ
```

Jira Cloud REST API v3. Maps ADF (Atlassian Document Format) to plain text. Handles transitions for status changes with configurable transition name matching.

### GitLab

```bash
npm run run-agent -- 42 \
  --connector gitlab \
  --base-url https://gitlab.myco.com \
  --token glpat-xxxx \
  --project-id 123
```

GitLab Issues API. Maps labels to priority/status (configurable). Handles scoped labels (`priority::high`, `status::pending`).

---

## Knowledge ingestion

Drop files in `knowledge/` manually, or pull from your existing sources:

### Local files

```bash
npm run index -- knowledge/
npm run index -- knowledge/ --force          # re-index everything
npm run index -- knowledge/ --stats          # check what's indexed
npm run index -- knowledge/ --chunk-size 800 # tune chunking
```

Supports `.md`, `.txt`, `.json`, `.pdf`. Language-aware chunking with configurable size and overlap. SHA-256 change detection skips unchanged files on re-index.

### Azure DevOps wikis + work items

```bash
npm run dev -- import-wiki \
  --source azuredevops \
  --org myorg \
  --project MyProject \
  --token $AZUREDEVOPS_TOKEN \
  --mode both            # wiki | workitems | both
```

Imports wiki pages as markdown and mines resolved work items (bugs, incidents) into knowledge articles.

### Confluence

```bash
npm run dev -- import-wiki \
  --source confluence \
  --base-url https://myco.atlassian.net/wiki \
  --email admin@myco.com \
  --api-token secret \
  --space-key IT,OPS      # comma-separated, or omit for all spaces
```

Paginates through spaces and pages. Converts Confluence storage format to markdown.

### URL scraping

```bash
npm run dev -- import-url \
  https://docs.myco.com/runbooks/password-reset \
  https://docs.myco.com/runbooks/vpn-setup \
  --output knowledge/scraped
```

Fetches pages, converts HTML to markdown, respects robots.txt (override with `--ignore-robots`).

### Ticket mining

Turn your resolved tickets into knowledge articles:

```bash
npm run dev -- mine-tickets \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --limit 200 \
  --min-comments 1 \
  --since 2025-01-01
```

Works with all three connectors. Filters by resolution date and comment quality. Each ticket becomes a structured markdown article with problem description, resolution thread, and metadata.

---

## Continuous mode

Watch for new tickets and process them automatically:

```bash
npm run dev -- watch \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --interval 60 \
  --batch-size 5 \
  --dry-run
```

Polls for open tickets on a configurable interval. Deduplicates across cycles. Batch size caps per-cycle work so a large backlog doesn't block the loop.

---

## Test retrieval

Search without running the full agent:

```bash
npm run dev -- search "VPN not connecting" --k 3
npm run dev -- search "disk full" --mmr --folder runbooks/
```

---

## Project layout

```
src/
  connectors/
    types.ts              Generic Ticket / Comment / Attachment types
    connector.ts          TicketConnector interface
    servicenow.ts         ServiceNow Table API adapter
    jira.ts               Jira Cloud REST API adapter
    gitlab.ts             GitLab Issues API adapter
  rag/
    indexer.ts            Chunk, embed, upsert (SHA-256 change detection)
    retriever.ts          Similarity + MMR search, metadata filters
  agent/
    agent.ts              LangGraph StateGraph, typed state, 7 tools
    poller.ts             Continuous polling loop with dedup + batching
  ingest/
    types.ts              Shared ingest types + idempotent file writer
    azure-devops.ts       AzDO wiki + work item importer
    confluence.ts         Confluence space/page importer
    url-scraper.ts        HTML -> markdown scraper with robots.txt
    ticket-miner.ts       Resolved ticket -> knowledge article miner
  cli.ts                  CLI entry point
knowledge/                Your runbooks, SOPs, and docs
```

---

## Adding a connector

1. Implement `TicketConnector` from `src/connectors/connector.ts`
2. Pass it as `deps.connector` when constructing `AgentGraph`

The interface covers: `listTickets`, `getTicket`, `getComments`, `addComment`, `listAttachments`, `downloadAttachment`, `uploadAttachment`, `updateTicket`.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| **ServiceNow** | | |
| `SERVICENOW_INSTANCE_URL` | For SN | e.g. `https://myco.service-now.com` |
| `SERVICENOW_USERNAME` | For SN | Username |
| `SERVICENOW_PASSWORD` | For SN | Password |
| **Jira** | | |
| `JIRA_BASE_URL` | For Jira | e.g. `https://myco.atlassian.net` |
| `JIRA_EMAIL` | For Jira | Atlassian account email |
| `JIRA_API_TOKEN` | For Jira | API token |
| **GitLab** | | |
| `GITLAB_BASE_URL` | For GL | e.g. `https://gitlab.myco.com` |
| `GITLAB_TOKEN` | For GL | Personal or project access token |
| **Azure DevOps** | | |
| `AZUREDEVOPS_ORG` | For import | Organization name |
| `AZUREDEVOPS_PROJECT` | For import | Project name |
| `AZUREDEVOPS_TOKEN` | For import | PAT |
| **Confluence** | | |
| `CONFLUENCE_BASE_URL` | For import | e.g. `https://myco.atlassian.net/wiki` |
| `CONFLUENCE_EMAIL` | For import | Atlassian account email |
| `CONFLUENCE_API_TOKEN` | For import | API token |

---

## Testing

```bash
npm test        # 271 unit tests, ~1.3s
npm run typecheck  # TypeScript strict mode
```

---

## Stack

| Layer | Tech |
|---|---|
| Agent orchestration | LangGraph (StateGraph) |
| LLM + embeddings | OpenAI via LangChain |
| Vector store | ChromaDB |
| Text splitting | LangChain (language-aware) |
| Connectors | ServiceNow, Jira, GitLab |
| Knowledge ingestion | Azure DevOps, Confluence, URL scraping, ticket mining |
| Runtime | Node 18+ / tsx |

---

## License

MIT
