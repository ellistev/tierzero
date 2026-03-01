# TierZero

AI-powered IT ticket resolution. Reads tickets, searches your runbooks, resolves or escalates - no human in the loop.

> **Tier 0** is the support level below Tier 1. Fully automated. No queue. No waiting.

Built with **LangGraph** + **LangChain** + **ChromaDB** + **OpenAI**.

---

## The Problem

Your L1 team spends 70% of their time on tickets that already have a documented fix. Password resets, VPN issues, printer jams - the runbook exists, someone just has to read it and follow the steps.

TierZero does that automatically:
1. Reads the ticket from ServiceNow, Jira, or GitLab
2. Searches your knowledge base (RAG) for the relevant procedure
3. Either resolves it, asks a clarifying question, or escalates with full context

Every action is auditable. Every decision includes reasoning and a confidence score. The agent knows what it doesn't know.

---

## Architecture

```
                         +------------------+
                         |   Ticket Source   |
                         | ServiceNow/Jira/ |
                         |     GitLab       |
                         +--------+---------+
                                  |
                                  v
+----------+   +-----------+   +----------+   +-------+   +----------+
|          |   |           |   |          |   |       |   |          |
|  ingest  +-->+  retrieve +-->+  decide  +-->+  act  +-->+  record  |
|          |   |           |   |          |   |       |   |          |
+----------+   +-----+-----+   +----+-----+   +---+---+   +----------+
                     |              |               |
                     v              v               v
               +-----------+  +---------+    +-------------+
               |  ChromaDB |  |  GPT-4o |    |  Connector  |
               |  (RAG)    |  |  (LLM)  |    |  (actions)  |
               +-----------+  +---------+    +-------------+
```

**No open-ended tool loops.** The agent plans once (structured LLM output with confidence score) then executes deterministically. Every run produces an internal audit trail.

### Decision types

| Decision | When | Action |
|---|---|---|
| `automate` | Clear, safe KB match | Post resolution, mark resolved |
| `draft_response` | Partial match or reporter already tried standard fix | Post helpful reply with next steps |
| `escalate` | Out of scope, safety-sensitive, or low confidence | Internal note + reassign to human team |
| `needs_info` | Too vague to act on | Ask one specific clarifying question |
| `implement` | Bug or feature with codebase access | Write code, create branch, run tests |

### Safety rails

The agent won't blindly auto-resolve everything it finds a KB match for:

- **Security incidents** (suspicious logins, breaches) always escalate to security team
- **Service account changes** and production-critical operations always escalate for human oversight
- **KB warnings** ("do NOT do this without...") are respected - the agent won't hand dangerous steps to a user
- **Already-tried fixes** are detected from the comment thread - no repeating what the user already did
- **Confidence threshold** with intelligent exemptions - `needs_info` isn't overridden (low confidence IS the reason you're asking)

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
npx tsx src/cli.ts index ./knowledge/

# Test retrieval
npx tsx src/cli.ts search "password reset procedure"

# Run on a real ticket (dry run first)
npx tsx src/cli.ts run INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --dry-run
```

---

## Real test results

14 end-to-end integration tests against live GPT-4o-mini + ChromaDB with a sample IT knowledge base:

```
T01 VPN timeout - exact KB match.................. PASS (automate, 0.90)
T02 Shared mailbox access request................. PASS (automate, 0.99)
T03 Print jobs stuck in queue..................... PASS (automate, 0.85)
T04 Password reset request........................ PASS (automate, 0.95)
T05 VPN cert expired - different symptom.......... PASS (draft_response, 0.80)
T06 MFA reset needed.............................. PASS (automate, 0.90)
T07 Emails not arriving from sender............... PASS (draft_response, 0.80)
T08 Physical hardware - server room AC............ PASS (escalate, 0.90)
T09 Budget approval - not IT operational.......... PASS (escalate, 0.80)
T10 Security incident - data breach............... PASS (escalate, 0.90)
T11 Completely vague ticket....................... PASS (needs_info, 0.20)
T12 Vague with some context...................... PASS (needs_info, 0.50)
T13 Prior troubleshooting in comments............. PASS (draft_response, 0.70)
T14 Service account password (dangerous).......... PASS (escalate, 0.90)

Results: 14 passed  0 failed
```

The agent correctly:
- Auto-resolves common issues it has documented procedures for
- Asks clarifying questions when tickets are too vague
- Escalates physical problems, security incidents, and dangerous operations
- Avoids repeating fixes the user already tried (reads comment threads)

---

## Connectors

Three connectors ship out of the box. Each implements `TicketConnector` - swap with a flag.

### ServiceNow

```bash
npx tsx src/cli.ts run INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret
```

Full Table API adapter: incidents, comments (public + work notes), attachments, status updates, assignment. Supports custom tables via `--table`.

### Jira

```bash
npx tsx src/cli.ts run PROJ-1234 \
  --instance-url https://myco.atlassian.net \
  --username agent@myco.com \
  --password api-token \
  --table jira
```

Jira Cloud REST API v3. Maps ADF to plain text. Handles transitions for status changes.

### GitLab

```bash
npx tsx src/cli.ts run 42 \
  --instance-url https://gitlab.myco.com \
  --username token \
  --password glpat-xxxx \
  --table gitlab
```

GitLab Issues API. Maps labels to priority/status. Handles scoped labels (`priority::high`).

---

## Knowledge ingestion

Drop markdown files in a folder, or pull from existing sources:

### Index local files

```bash
npx tsx src/cli.ts index ./knowledge/
npx tsx src/cli.ts index ./knowledge/ --force          # re-index everything
npx tsx src/cli.ts index ./knowledge/ --stats          # check what's indexed
npx tsx src/cli.ts index ./knowledge/ --chunk-size 800 # tune chunking
```

Supports `.md`, `.txt`, `.json`. Language-aware chunking with configurable size and overlap. SHA-256 change detection skips unchanged files.

### Azure DevOps wikis + work items

```bash
npx tsx src/cli.ts import-wiki \
  --source azuredevops \
  --org myorg \
  --project MyProject \
  --token $AZUREDEVOPS_TOKEN \
  --mode both
```

### Confluence

```bash
npx tsx src/cli.ts import-wiki \
  --source confluence \
  --base-url https://myco.atlassian.net/wiki \
  --email admin@myco.com \
  --api-token secret \
  --space-key IT,OPS
```

### URL scraping

```bash
npx tsx src/cli.ts import-url \
  https://docs.myco.com/runbooks/vpn-setup \
  --output knowledge/scraped
```

### Ticket mining

Turn your resolved tickets into knowledge articles:

```bash
npx tsx src/cli.ts mine-tickets \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --limit 200 \
  --min-comments 1 \
  --since 2025-01-01
```

Works with all three connectors. Each resolved ticket becomes a structured knowledge article.

---

## Code implementation

TierZero can write code to fix bugs or implement features:

```bash
npx tsx src/cli.ts run BUG-1234 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --codebase ./my-project \
  --coding-model claude-sonnet-4-20250514 \
  --test-command "npm test"
```

The agent:
1. Reads the ticket and KB for context
2. Decides `implement` if it's a code-fixable bug/feature
3. Creates a branch, reads relevant files, writes the fix
4. Runs your test suite to verify
5. Posts results back to the ticket

Supports **OpenAI**, **Anthropic (Claude)**, and **Google (Gemini)** as coding models.

---

## Continuous mode

Watch for new tickets and process them automatically:

```bash
npx tsx src/cli.ts watch \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --interval 60 \
  --batch-size 5 \
  --dry-run
```

Polls on a configurable interval. Deduplicates across cycles. Batch size caps per-cycle work.

---

## Project layout

```
src/
  agent/
    agent.ts              LangGraph StateGraph - the brain
    poller.ts             Continuous polling loop with dedup
  connectors/
    connector.ts          TicketConnector interface
    servicenow.ts         ServiceNow Table API
    jira.ts               Jira Cloud REST API
    gitlab.ts             GitLab Issues API
  rag/
    indexer.ts            Chunk, embed, upsert to ChromaDB
    retriever.ts          Similarity + MMR search
  ingest/
    azure-devops.ts       AzDO wiki + work item importer
    confluence.ts         Confluence importer
    url-scraper.ts        HTML -> markdown scraper
    ticket-miner.ts       Resolved ticket -> KB article
  coder/
    implementer.ts        Code generation + git workflow
    file-context.ts       Smart file selection for LLM context
    providers.ts          Multi-provider LLM factory
  cli.ts                  CLI entry point
```

---

## Testing

```bash
npm test           # 321 unit tests, ~1.3s
npx tsc --noEmit   # TypeScript strict mode, zero errors
```

---

## Stack

| Layer | Tech |
|---|---|
| Agent orchestration | LangGraph (StateGraph) |
| LLM + embeddings | OpenAI via LangChain |
| Vector store | ChromaDB |
| Connectors | ServiceNow, Jira, GitLab |
| Knowledge ingestion | Azure DevOps, Confluence, URL scraping, ticket mining |
| Code implementation | OpenAI, Anthropic, Google (multi-provider) |
| Runtime | Node 20+ / TypeScript |

---

## License

MIT
