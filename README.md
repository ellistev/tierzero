# TierZero

An AI agent that reads IT support tickets, searches a knowledge base of runbooks and procedures, and takes action -- posting a resolution, asking a clarifying question, or escalating with full context.

> **Tier 0** is the IT support level below Tier 1 -- fully automated, no human required.

Built with **LangGraph** + **LangChain** + **ChromaDB** + **OpenAI**.

## How it works

```
Ticket arrives
     │
     ▼
[ingest]    Load full comment thread from ServiceNow
     │
     ▼
[retrieve]  RAG search the knowledge/ folder (MMR, top-5 chunks)
     │
     ▼
[decide]    Single structured LLM call → decision + reasoning + drafted reply
     │
     ├─ automate       → post resolution publicly, mark resolved
     ├─ draft_response → post helpful reply, wait for reporter
     ├─ escalate       → post internal note with full reasoning, assign to human
     └─ needs_info     → ask reporter one specific clarifying question
     │
     ▼
[record]    Post internal audit note: decision, KB sources, step log
```

**No open-ended tool loop.** The agent plans once (structured LLM output with confidence score) then executes deterministically. Confidence below threshold → automatic escalation. Every run leaves a traceable internal note.

## Project layout

```
src/
  connectors/
    types.ts          Generic Ticket / TicketComment / TicketAttachment interfaces
    connector.ts      TicketConnector interface (the contract every adapter implements)
    servicenow.ts     ServiceNow Table API adapter
  rag/
    indexer.ts        Walk knowledge/, chunk, embed, upsert into ChromaDB
    retriever.ts      Similarity search + MMR, metadata filtering, score threshold
  agent/
    agent.ts          LangGraph StateGraph: ingest → retrieve → decide → act → record
  cli.ts              Entry point: index / search / run commands
knowledge/            Drop your runbooks, SOPs, and docs here
```

## Setup

**Prerequisites:** Node 18+, an OpenAI API key, a running ChromaDB instance.

```bash
# Start ChromaDB (Docker)
docker run -p 8000:8000 chromadb/chroma

# Install
npm install

# Configure
cp .env.example .env
# Edit .env -- set OPENAI_API_KEY and optionally ServiceNow credentials
```

## Usage

### 1. Build the knowledge base

Drop `.md`, `.txt`, `.json`, or `.pdf` files into `knowledge/` (any folder depth), then:

```bash
npm run index -- knowledge/

# Options
npm run index -- knowledge/ --force          # re-index everything
npm run index -- knowledge/ --stats          # show what's indexed, don't re-index
npm run index -- knowledge/ --chunk-size 800 --chunk-overlap 150
```

### 2. Test retrieval (no agent, no ticket system)

```bash
npm run dev -- search "password reset procedure"
npm run dev -- search "VPN not connecting" --folder runbooks/ --k 3
npm run dev -- search "disk full" --mmr      # diverse results across docs
```

### 3. Run the agent on a real ticket

```bash
npm run run-agent -- INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret

# Or set env vars and omit flags
SERVICENOW_INSTANCE_URL=https://myco.service-now.com \
SERVICENOW_USERNAME=svc-agent \
SERVICENOW_PASSWORD=secret \
npm run run-agent -- INC0012345

# Dry run -- see what the agent would do without touching the ticket
npm run run-agent -- INC0012345 --dry-run
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `SERVICENOW_INSTANCE_URL` | For `run` | e.g. `https://myco.service-now.com` |
| `SERVICENOW_USERNAME` | For `run` | ServiceNow username |
| `SERVICENOW_PASSWORD` | For `run` | ServiceNow password |

## Knowledge base structure

Organise your `knowledge/` folder however makes sense. Source paths are stored as metadata, so folder names become a filter dimension:

```
knowledge/
  runbooks/
    password-reset.md
    vpn-troubleshooting.md
    disk-cleanup.md
  policies/
    escalation-matrix.md
    sla-definitions.md
  config/
    team-contacts.json
```

Then search or restrict the agent to a folder:

```bash
npm run dev -- search "reset password" --folder runbooks/
```

## Adding a new connector

1. Implement `TicketConnector` from `src/connectors/connector.ts`
2. Pass an instance as `deps.connector` when constructing `AgentGraph`

The connector interface covers: `listTickets`, `getTicket`, `getComments`, `addComment`, `listAttachments`, `downloadAttachment`, `uploadAttachment`.

## Tech stack

| Layer | Package | Version |
|---|---|---|
| Agent graph | `@langchain/langgraph` | 1.2.x |
| LLM / embeddings | `@langchain/openai` | 1.2.x |
| Vector store | `@langchain/community` + `chromadb` | 1.1.x / 3.3.x |
| Text splitting | `@langchain/textsplitters` | 1.0.x |
| Runtime | `tsx` (no compile step) | 4.x |
