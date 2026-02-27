# TierZero

AI-powered IT ticket resolution. Reads tickets, searches your runbooks, resolves or escalates -- no human in the loop.

> **Tier 0** is the support level below Tier 1. Fully automated. No queue. No waiting.

Built with **LangGraph** + **LangChain** + **ChromaDB** + **OpenAI**.

---

## Why

Your L1 team spends 70% of their time on tickets that already have a documented fix. Password resets, VPN issues, disk cleanup -- the runbook exists, someone just has to read it and follow the steps.

TierZero does that automatically:
1. Reads the ticket
2. Searches your knowledge base for the relevant procedure
3. Either resolves it, asks a clarifying question, or escalates with full context

Every action is auditable. Every decision includes reasoning. Confidence below threshold = automatic escalation to a human. The agent knows what it doesn't know.

---

## How it works

```
Ticket arrives
     │
     ▼
[ingest]    Load full comment thread from ServiceNow
     │
     ▼
[retrieve]  RAG search the knowledge/ folder (MMR, top-K chunks)
     │
     ▼
[decide]    Structured LLM call → decision + reasoning + confidence score
     │
     ├─ automate       → post resolution, mark resolved
     ├─ draft_response → post helpful reply, wait for confirmation
     ├─ escalate       → internal note with full context, reassign to human
     └─ needs_info     → ask reporter one specific clarifying question
     │
     ▼
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

# Run on a real ticket
npm run run-agent -- INC0012345 --instance-url https://myco.service-now.com --dry-run
```

---

## Project layout

```
src/
  connectors/
    types.ts          Generic Ticket / Comment / Attachment interfaces
    connector.ts      TicketConnector interface (contract for any adapter)
    servicenow.ts     ServiceNow Table API adapter (full CRUD)
  rag/
    indexer.ts        Chunk, embed, upsert into ChromaDB (with change detection)
    retriever.ts      Similarity + MMR search, metadata filters, score thresholds
  agent/
    agent.ts          LangGraph StateGraph with typed state + 7 tools
  cli.ts              CLI: index / search / run
knowledge/            Your runbooks, SOPs, and docs go here
```

---

## Usage

### Index your knowledge base

Drop `.md`, `.txt`, `.json`, or `.pdf` files into `knowledge/`:

```bash
npm run index -- knowledge/
npm run index -- knowledge/ --force            # re-index everything
npm run index -- knowledge/ --stats            # check what's indexed
npm run index -- knowledge/ --chunk-size 800   # tune chunking
```

### Test retrieval

Search without running the full agent:

```bash
npm run dev -- search "VPN not connecting" --k 3
npm run dev -- search "disk full" --mmr --folder runbooks/
```

### Run the agent

```bash
# With flags
npm run run-agent -- INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret

# With env vars
SERVICENOW_INSTANCE_URL=https://myco.service-now.com \
SERVICENOW_USERNAME=svc-agent \
SERVICENOW_PASSWORD=secret \
npm run run-agent -- INC0012345

# Dry run -- see what it would do without touching anything
npm run run-agent -- INC0012345 --dry-run
```

---

## Adding a connector

TierZero ships with a ServiceNow connector. Adding Jira, Zendesk, or anything else:

1. Implement `TicketConnector` from `src/connectors/connector.ts`
2. Pass it as `deps.connector` when constructing `AgentGraph`

The interface covers: `listTickets`, `getTicket`, `getComments`, `addComment`, `listAttachments`, `downloadAttachment`, `uploadAttachment`.

---

## Knowledge base structure

Organize however you want. Folder paths become a searchable filter:

```
knowledge/
  runbooks/
    password-reset.md
    vpn-troubleshooting.md
  policies/
    escalation-matrix.md
    sla-definitions.md
  config/
    team-contacts.json
```

```bash
npm run dev -- search "reset password" --folder runbooks/
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `SERVICENOW_INSTANCE_URL` | For `run` | e.g. `https://myco.service-now.com` |
| `SERVICENOW_USERNAME` | For `run` | ServiceNow username |
| `SERVICENOW_PASSWORD` | For `run` | ServiceNow password |

---

## Stack

| Layer | Tech |
|---|---|
| Agent orchestration | LangGraph (StateGraph) |
| LLM + embeddings | OpenAI via LangChain |
| Vector store | ChromaDB |
| Text splitting | LangChain (language-aware) |
| Connector | ServiceNow Table API |
| Runtime | Node 18+ / tsx |

---

## License

MIT
