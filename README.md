# TierZero

AI-powered autonomous ticket resolution. Picks up tickets, searches your knowledge base, does the work, closes the ticket. No human in the loop.

> **Tier 0** is the support level below Tier 1. Fully automated. No queue. No waiting.

Built with **LangGraph** + **LangChain** + **ChromaDB** + **OpenAI** + **Playwright**.

---

## Table of Contents

- [The Problem](#the-problem)
- [What TierZero Does](#what-tierzero-does)
- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Knowledge Ingestion](#knowledge-ingestion)
  - [Index Local Files](#index-local-files)
  - [Azure DevOps Wikis + Work Items](#azure-devops-wikis--work-items)
  - [Confluence](#confluence)
  - [URL Scraping](#url-scraping)
  - [Ticket Mining](#ticket-mining)
- [Running the Agent](#running-the-agent)
  - [Single Ticket](#single-ticket)
  - [Continuous Watch Mode](#continuous-watch-mode)
  - [Dry Run Mode](#dry-run-mode)
- [Connectors](#connectors)
  - [ServiceNow](#servicenow)
  - [Jira](#jira)
  - [GitLab](#gitlab)
  - [Adding a Custom Connector](#adding-a-custom-connector)
- [Code Implementation](#code-implementation)
- [Browser Automation](#browser-automation)
  - [The IntentEngine](#the-intentengine)
  - [Resolution Strategy Chain](#resolution-strategy-chain)
  - [Recovery Strategies](#recovery-strategies)
  - [Page State Understanding](#page-state-understanding)
  - [Connecting to Chrome](#connecting-to-chrome)
- [Workflow Recording](#workflow-recording)
  - [Recording a Workflow](#recording-a-workflow)
  - [Generating a Workflow](#generating-a-workflow)
  - [Replaying a Workflow](#replaying-a-workflow)
  - [How Recording Works](#how-recording-works)
- [Skills System](#skills-system)
  - [Skill Structure](#skill-structure)
  - [Built-in Skills](#built-in-skills)
  - [Auto-Generated Skills](#auto-generated-skills)
  - [Creating a Custom Skill](#creating-a-custom-skill)
- [Event Sourcing + CQRS](#event-sourcing--cqrs)
- [Architecture](#architecture)
  - [Agent Pipeline](#agent-pipeline)
  - [Decision Types](#decision-types)
  - [Safety Rails](#safety-rails)
- [Testing](#testing)
- [Project Layout](#project-layout)
- [Stack](#stack)
- [License](#license)

---

## The Problem

Your L1 team spends 70% of their time on tickets that already have a documented fix. Password resets, VPN issues, printer jams -- the runbook exists, someone just has to read it and follow the steps.

Traditional automation (RPA, scripted bots) breaks every time the UI changes. Button renamed? Script dies. New modal? Script dies. Column reordered? Script dies. The failure rate for RPA implementations is 30-50%.

TierZero solves both problems: autonomous resolution with self-healing execution.

---

## What TierZero Does

1. **Picks up tickets** from ServiceNow, Jira, or GitLab
2. **Reads the full context** -- description, comment thread, related tickets
3. **Searches your knowledge base** (RAG) for the relevant procedure
4. **Makes a decision** -- resolve, respond, ask for info, escalate, or implement code
5. **Executes the decision** -- browser automation, code changes, or API calls
6. **Closes the ticket** with full audit trail and KB sources cited
7. **Adapts when UIs change** -- intent-based automation, not brittle selectors

Every action is auditable. Every decision includes reasoning and a confidence score. The agent knows what it doesn't know and escalates accordingly.

---

## Quick Start

```bash
# 1. Start ChromaDB (vector store for RAG)
docker run -p 8000:8000 chromadb/chroma

# 2. Install dependencies
git clone https://github.com/ellistev/tierzero.git
cd tierzero
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env -- add your OPENAI_API_KEY at minimum

# 4. Index your knowledge base
npx tsx src/cli.ts index ./knowledge/

# 5. Test retrieval
npx tsx src/cli.ts search "password reset procedure"

# 6. Run on a ticket (dry run first!)
npx tsx src/cli.ts run INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --dry-run

# 7. Go live (remove --dry-run)
npx tsx src/cli.ts run INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret
```

---

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | 18+ | Runtime |
| Docker | Any | ChromaDB container |
| OpenAI API key | -- | LLM + embeddings |
| Chrome | Any | Browser automation (optional) |
| Playwright | -- | Installed with npm install (browser testing) |

**Optional:**
- Anthropic API key (for Claude coding model)
- Google AI API key (for Gemini coding model)
- Azure DevOps PAT (for wiki/work item import)
- Confluence API token (for Confluence import)

---

## Installation

```bash
git clone https://github.com/ellistev/tierzero.git
cd tierzero
npm install
```

This installs all dependencies including LangChain, LangGraph, ChromaDB client, Playwright, and Express.

### Verify Installation

```bash
npm test          # Should show 243+ tests passing
npx tsc --noEmit  # TypeScript strict mode, zero errors
```

---

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

### Required Environment Variables

```env
# LLM (required)
OPENAI_API_KEY=sk-...

# ChromaDB (defaults shown)
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=knowledge
```

### Optional Environment Variables

```env
# ServiceNow connector
SERVICENOW_INSTANCE_URL=https://myco.service-now.com
SERVICENOW_USERNAME=svc-agent
SERVICENOW_PASSWORD=secret

# Jira connector
JIRA_BASE_URL=https://myco.atlassian.net
JIRA_EMAIL=agent@myco.com
JIRA_API_TOKEN=secret
JIRA_PROJECT_KEY=IT

# GitLab connector
GITLAB_BASE_URL=https://gitlab.myco.com
GITLAB_TOKEN=glpat-xxxx
GITLAB_PROJECT_ID=42

# Azure DevOps (for wiki import)
AZUREDEVOPS_ORG=myorg
AZUREDEVOPS_PROJECT=MyProject
AZUREDEVOPS_TOKEN=pat-xxxx

# Confluence (for page import)
CONFLUENCE_BASE_URL=https://myco.atlassian.net/wiki
CONFLUENCE_EMAIL=admin@myco.com
CONFLUENCE_API_TOKEN=secret

# Coding model (for code implementation)
# Supports: gpt-4o, claude-sonnet-4-20250514, gemini-2.5-pro, etc.
CODING_MODEL=claude-sonnet-4-20250514
CODING_API_KEY=sk-ant-...
```

### Starting ChromaDB

ChromaDB is the vector store used for RAG retrieval. Run it in Docker:

```bash
docker run -d --name chroma -p 8000:8000 chromadb/chroma
```

Verify it's running:

```bash
curl http://localhost:8000/api/v1/heartbeat
```

---

## Knowledge Ingestion

TierZero learns from your existing documentation. The more knowledge you feed it, the better it resolves tickets. No model training required -- it uses RAG (Retrieval Augmented Generation) to search your docs at runtime.

### Index Local Files

Drop markdown, text, or JSON files in a folder and index them:

```bash
# Index a knowledge directory
npx tsx src/cli.ts index ./knowledge/

# Force re-index everything (ignores change detection)
npx tsx src/cli.ts index ./knowledge/ --force

# Check what's currently indexed
npx tsx src/cli.ts index ./knowledge/ --stats

# Tune chunk size (default: 1000 chars, 200 overlap)
npx tsx src/cli.ts index ./knowledge/ --chunk-size 800 --chunk-overlap 150
```

**Supported formats:** `.md`, `.txt`, `.json`

**How it works:**
1. Files are split into chunks (configurable size with overlap for context)
2. Each chunk is embedded using OpenAI's text-embedding model
3. Embeddings are stored in ChromaDB with source metadata
4. SHA-256 change detection skips unchanged files on re-index

**Recommended knowledge structure:**

```
knowledge/
  runbooks/
    vpn-setup.md
    password-reset.md
    printer-troubleshooting.md
  policies/
    escalation-matrix.md
    security-incident-response.md
  faq/
    common-issues.md
```

### Azure DevOps Wikis + Work Items

Pull knowledge from Azure DevOps:

```bash
# Import wiki pages + work items
npx tsx src/cli.ts import-wiki \
  --source azuredevops \
  --org myorg \
  --project MyProject \
  --token $AZUREDEVOPS_TOKEN \
  --mode both

# Wiki only
npx tsx src/cli.ts import-wiki --source azuredevops --mode wiki ...

# Work items only (resolved tickets as KB articles)
npx tsx src/cli.ts import-wiki --source azuredevops --mode workitems --limit 200 ...
```

### Confluence

Pull knowledge from Confluence:

```bash
npx tsx src/cli.ts import-wiki \
  --source confluence \
  --base-url https://myco.atlassian.net/wiki \
  --email admin@myco.com \
  --api-token secret \
  --space-key IT,OPS
```

Omit `--space-key` to import all spaces.

### URL Scraping

Scrape documentation websites:

```bash
npx tsx src/cli.ts import-url \
  https://docs.myco.com/runbooks/vpn \
  https://docs.myco.com/runbooks/printer \
  --output knowledge/scraped
```

Respects `robots.txt` by default. Pass `--ignore-robots` to override.

### Ticket Mining

Turn your resolved tickets into knowledge articles:

```bash
npx tsx src/cli.ts mine-tickets \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --limit 200 \
  --min-comments 1 \
  --since 2025-01-01 \
  --output knowledge/tickets
```

Works with all three connectors (servicenow, jira, gitlab). Each resolved ticket with solution comments becomes a structured knowledge article that future tickets can learn from.

### Testing Your Knowledge Base

After indexing, test retrieval:

```bash
# Basic search
npx tsx src/cli.ts search "VPN not connecting"

# Search with filters
npx tsx src/cli.ts search "password reset" --folder runbooks/ --k 3

# Diverse results (MMR)
npx tsx src/cli.ts search "network issues" --mmr
```

---

## Running the Agent

### Single Ticket

Process one ticket:

```bash
npx tsx src/cli.ts run INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --model gpt-4o-mini
```

The agent will:
1. Fetch the ticket and its comment thread
2. Search the knowledge base for relevant procedures
3. Make a decision (automate, draft_response, escalate, needs_info, or implement)
4. Execute the decision (post comment, resolve, reassign, etc.)
5. Post an internal audit note documenting everything

### Continuous Watch Mode

Process tickets automatically as they come in:

```bash
npx tsx src/cli.ts watch \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --interval 60 \
  --batch-size 5
```

Options:
- `--interval <seconds>` -- poll frequency (default: 60)
- `--batch-size <n>` -- max tickets per cycle (default: unlimited)
- `--max-tickets <n>` -- stop after N total tickets (default: run forever)

Sample output:

```
Watching for open tickets  interval: 60s

[14:32:01] → INC0401474  VPN not connecting from remote office
           ✓ automate (0.91)  action: resolved
[14:32:08] → INC0401489  Suspicious login from unknown IP
           ! escalate (0.95)  action: escalated to Security
[14:33:01] → INC0401502  Can't print to 3rd floor printer
           ✓ automate (0.87)  action: resolved
[14:34:01] No new open tickets
```

### Dry Run Mode

Test decisions without touching real tickets:

```bash
npx tsx src/cli.ts run INC0012345 ... --dry-run
npx tsx src/cli.ts watch ... --dry-run
```

Dry run logs what the agent *would* do without posting comments, changing status, or reassigning tickets.

---

## Connectors

### ServiceNow

```bash
npx tsx src/cli.ts run INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --table incident
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

Jira Cloud REST API v3. Maps ADF (Atlassian Document Format) to plain text. Handles transitions for status changes.

### GitLab

```bash
npx tsx src/cli.ts run 42 \
  --instance-url https://gitlab.myco.com \
  --username token \
  --password glpat-xxxx \
  --table gitlab
```

GitLab Issues API. Maps labels to priority/status. Handles scoped labels (`priority::high`).

### Adding a Custom Connector

Implement the `TicketConnector` interface (7 methods):

```typescript
import type { TicketConnector } from './src/connectors/connector';

class MyConnector implements TicketConnector {
  async getTicket(id: string) { ... }
  async listTickets(options?) { ... }
  async getComments(ticketId: string) { ... }
  async addComment(ticketId, body, options?) { ... }
  async updateTicket(ticketId, updates) { ... }
  async search(query, options?) { ... }
  async getEscalationTeams() { ... }
}
```

TierZero handles the rest -- the agent pipeline is connector-agnostic.

---

## Code Implementation

When a ticket is a bug or feature request and you've configured a codebase, TierZero can write the fix:

```bash
npx tsx src/cli.ts run BUG-1234 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --codebase ./my-project \
  --coding-model claude-sonnet-4-20250514 \
  --test-command "npm test"
```

**What the agent does:**

1. Decides this is an `implement` ticket based on KB context
2. Creates a feature branch (`tierzero/BUG-1234`)
3. Analyzes the codebase for relevant files (smart file selection)
4. Writes the fix using your chosen coding model
5. Runs your test suite (`--test-command`)
6. Commits with a descriptive message
7. Posts the diff summary and test results to the ticket

**Supported coding models:**

| Provider | Models |
|---|---|
| OpenAI | gpt-4o, gpt-4o-mini |
| Anthropic | claude-sonnet-4-20250514, claude-opus-4-20250514 |
| Google | gemini-2.5-pro, gemini-2.5-flash |

Provider is auto-detected from the model name. Override with `--coding-provider`.

---

## Browser Automation

When the work requires browser interaction (navigating ServiceNow, filling forms, clicking through admin panels), TierZero uses an adaptive, self-healing approach.

### The IntentEngine

Instead of hardcoded selectors (`#btn-submit`), TierZero uses **intents** -- descriptions of what to achieve:

```typescript
const intent: Intent = {
  name: "click-resolve",
  goal: "Click the Resolve button",
  page: "ticket-detail",
};

const result = await engine.execute(intent, page);
// result.success === true (found via aria strategy)
// result.method === "aria"
// result.durationMs === 180
```

The IntentEngine figures out HOW to achieve the goal at runtime, adapting to whatever the page looks like.

### Resolution Strategy Chain

Five strategies tried in order. If one fails, the next kicks in:

| # | Strategy | Speed | How It Works |
|---|---|---|---|
| 1 | **Cached** | ~50ms | Tries the last-known-good selector from the cache |
| 2 | **Aria** | ~200ms | Finds by accessibility role + label (handles text changes) |
| 3 | **LLM (A11y Tree)** | ~500ms | Feeds accessibility tree to GPT-4o-mini |
| 4 | **LLM (Vision)** | ~1s | Screenshots the page, asks GPT-4o to locate element |
| 5 | **Coordinates** | ~1.5s | Asks LLM for pixel coordinates, clicks directly |

### Recovery Strategies

When an action fails (unexpected modal, error page, wrong state):

- **Dialog Dismissal** -- detects and closes unexpected modals/alerts
- **LLM Recovery** -- analyzes page content, suggests corrective action (navigate, wait, dismiss)
- **Page State Assertions** -- verifies expected state between steps, retries if wrong

### Page State Understanding

The `capturePageState()` function creates structured snapshots of pages:

- URL, title, visible text
- Forms, buttons, links, modals
- Error messages, toasts
- Page classification (login, form, list, detail, dashboard, error)
- State diffing between before/after actions

### Connecting to Chrome

TierZero connects to Chrome via CDP (Chrome DevTools Protocol):

```typescript
import { connectChrome } from './src/browser';

const browser = await connectChrome();
// Uses CDP on localhost:18792 by default
// Auto-launches Chrome if not running
```

Configure the CDP URL in your environment or pass options:

```typescript
const browser = await connectChrome({
  cdpUrl: 'http://localhost:9222',
  userDataDir: '/path/to/chrome/profile',
  noLaunch: true, // Don't auto-launch
});
```

---

## Workflow Recording

TierZero can learn new workflows by watching a human do it once. No coding required.

### Recording a Workflow

```bash
# Start recording on a URL
npx tsx src/cli.ts record start http://myapp.com/login

# The browser opens. Do your task (click, type, navigate).
# When done:
npx tsx src/cli.ts record stop

# List recorded sessions
npx tsx src/cli.ts record list
```

**What gets captured:**
- Every click (element, coordinates, text, aria info)
- Every keystroke (field, value)
- Every navigation
- Page state snapshots before and after each action
- State changes between steps

### Generating a Workflow

```bash
# Generate workflow + skill from a recording
npx tsx src/cli.ts record generate <session-file>
```

**What gets generated:**

1. **Annotated session** -- LLM adds semantic descriptions ("Clicked the Search button in the nav bar")
2. **Variable detection** -- ticket IDs, typed text = variables; button labels = constants
3. **Intent-based workflow** -- each step is a goal ("Click Resolve"), not a selector
4. **Hot-loadable skill** -- complete `skill.json` + `index.ts` ready to drop into the skills directory

### Replaying a Workflow

```bash
# Replay a generated workflow
npx tsx src/cli.ts record replay <workflow-file>
```

The replay uses the IntentEngine, so it adapts to UI changes. A workflow recorded on one layout works on a different layout because the intents describe WHAT to do, not HOW.

### How Recording Works

The pipeline:

```
Human Demo → CDP Recorder → Action Annotator → Workflow Generator → Skill Generator
     ↓              ↓              ↓                  ↓                    ↓
  Clicks/types   Raw events   Semantic meaning   Intent-based steps   Deployable skill
```

**Key design principle:** The recording captures WHAT the human did. The generator converts to WHY (intent goals). Replay figures out HOW adaptively. If the UI changes, the skill still works.

**Programmatic API:**

```typescript
import { RecordingController } from './src/recorder';

const controller = new RecordingController();

// Start recording
await controller.startRecording(page, { captureScreenshots: true });

// Human does their task...

// Stop and generate
const session = await controller.stopRecording();
const result = await controller.generateFromRecording(session);

// result.workflow -- intent-based workflow
// result.skill -- generated skill files
```

---

## Skills System

TierZero's capabilities are modular, hot-loadable skills. Each skill provides specific domain capabilities that the agent can use during execution.

### Skill Structure

```
skills/
  my-skill/
    skill.json          # Manifest (name, version, capabilities, config schema)
    index.ts            # Entry point implementing SkillProvider
```

**skill.json:**

```json
{
  "name": "servicenow-forms",
  "version": "1.0.0",
  "description": "Navigate and fill ServiceNow forms",
  "capabilities": [
    "navigate-servicenow",
    "fill-incident-form",
    "resolve-incident"
  ],
  "config": {
    "instanceUrl": {
      "type": "string",
      "required": true,
      "env": "SERVICENOW_INSTANCE_URL"
    }
  }
}
```

**index.ts:**

```typescript
import type { SkillFactory, SkillProvider, SkillManifest, SkillConfig } from '../../src/skills/types';

const factory: SkillFactory = (manifest: SkillManifest): SkillProvider => ({
  manifest,
  async initialize(config: SkillConfig) {
    // Set up connections, validate config
  },
  getCapability(name: string) {
    switch (name) {
      case 'resolve-incident': return async (ticketId: string) => { ... };
      default: return null;
    }
  },
  listCapabilities() {
    return ['navigate-servicenow', 'fill-incident-form', 'resolve-incident'];
  },
  async dispose() {
    // Clean up
  },
});

export default factory;
```

### Built-in Skills

| Skill | Description |
|---|---|
| `servicenow` | Navigate ServiceNow, handle SSO, fill forms, resolve incidents |
| `app-insights` | Query Azure Application Insights, investigate errors |
| `hue-lights` | Control Philips Hue lights (on/off, colors, scenes) |
| `nest-camera` | Check Nest camera status, get snapshots |
| `nest-thermostat` | Read temperature, set schedules, eco mode |

### Auto-Generated Skills

When you record a workflow, TierZero generates a complete skill:

```bash
npx tsx src/cli.ts record generate ./recordings/resolve-ticket.json
# Creates: skills/resolve-ticket/skill.json + index.ts
```

The generated skill uses IntentEngine + ActionChain for adaptive execution. Drop it in the skills directory and restart -- it's immediately available.

### Creating a Custom Skill

1. Create a folder in `skills/` with `skill.json` and `index.ts`
2. Implement the `SkillProvider` interface
3. Register capabilities the agent can call
4. TierZero auto-loads skills on startup

---

## Event Sourcing + CQRS

TierZero is built on Event Sourcing. Every action produces immutable events.

### Domain Aggregates

| Aggregate | Events |
|---|---|
| **Ticket** | Created, Commented, Resolved, Escalated, Assigned |
| **IntentExecution** | Attempted, SelectorResolved, Succeeded, Failed, RecoveryAttempted, RecoverySucceeded, Escalated |
| **WorkflowExecution** | Started, StepCompleted, StepFailed, Completed, Failed |

### Why This Matters

- **Full audit trail** -- every decision, every action, every recovery attempt is recorded
- **Selector cache** -- successful selectors cached as read models, speeds up future runs
- **Replay debugging** -- reproduce any failure from the event stream
- **Analytics** -- resolution rates, confidence trends, escalation patterns, strategy success rates

---

## Architecture

### Agent Pipeline

Five-node LangGraph StateGraph. Every ticket flows through the same graph:

```
START → ingest → retrieve → decide → act → record → END
```

| Node | Purpose |
|---|---|
| **ingest** | Load full comment thread from the connector |
| **retrieve** | RAG search the knowledge base using ticket title + description |
| **decide** | Structured LLM call -- decision + reasoning + confidence + drafted reply |
| **act** | Execute the decision deterministically (no open-ended tool loop) |
| **record** | Post internal audit note summarizing the full run |

### Decision Types

| Decision | When | Action |
|---|---|---|
| `automate` | Clear, safe KB match | Post resolution, mark resolved |
| `draft_response` | Partial match or reporter already tried standard fix | Post helpful reply with next steps |
| `escalate` | Out of scope, safety-sensitive, or low confidence | Internal note + reassign to human team |
| `needs_info` | Too vague to act on | Ask one specific clarifying question |
| `implement` | Bug or feature with codebase access | Write code, create branch, run tests |

### Safety Rails

The agent won't blindly auto-resolve everything:

- **Security incidents** (suspicious logins, breaches) always escalate to security team
- **Service account changes** and production-critical operations always escalate for human oversight
- **KB warnings** ("do NOT do this without...") are respected
- **Already-tried fixes** detected from comment thread -- no repeating what the user already did
- **Confidence threshold** (default 0.4) -- below this, auto-escalate with context
- **Dry run mode** for testing decisions without touching real systems

---

## Testing

```bash
# Unit tests (243+ tests, ~2s)
npm test

# TypeScript type checking
npx tsc --noEmit

# E2E integration tests (browser automation demo)
npm run test:e2e
```

### Real Test Results

14 end-to-end integration tests against live GPT-4o-mini + ChromaDB:

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
```

---

## Project Layout

```
src/
  agent/
    agent.ts              LangGraph StateGraph -- the brain
    poller.ts             Continuous polling loop with dedup
  browser/
    connection.ts         Chrome CDP connection management
    auth.ts               SSO login + org modal handling
    page-state.ts         Page state capture, classification, diffing
    index.ts              Browser exports
  connectors/
    connector.ts          TicketConnector interface
    servicenow.ts         ServiceNow Table API
    jira.ts               Jira Cloud REST API
    gitlab.ts             GitLab Issues API
    types.ts              Shared connector types
  coder/
    implementer.ts        Code generation + git workflow
    file-context.ts       Smart file selection for LLM context
    providers.ts          Multi-provider LLM factory (OpenAI/Anthropic/Google)
    types.ts              Coding types
  domain/
    ticket/               Ticket aggregate (ES/CQRS)
    intent-execution/     IntentExecution aggregate
    workflow-execution/   WorkflowExecution aggregate
  infra/
    aggregate.ts          Base aggregate class
    interfaces.ts         Event store interfaces
    snapshot.ts           Snapshot support
  ingest/
    azure-devops.ts       AzDO wiki + work item importer
    confluence.ts         Confluence importer
    url-scraper.ts        HTML -> markdown scraper
    ticket-miner.ts       Resolved ticket -> KB article
    types.ts              Ingest result types
  intents/
    engine.ts             IntentEngine -- 5-strategy adaptive resolution
    types.ts              Intent, ResolvedIntent, LLMProvider interfaces
    resolver.ts           CachedStrategy, AriaStrategy, LLMStrategy, VisionStrategy, CoordinateStrategy
    recovery.ts           DismissDialogRecovery, LLMRecovery
    parser.ts             Smart intent parsing (LLM-based)
    chain.ts              Multi-step ActionChain with state verification
    assertions.ts         Page state assertions
    providers/
      openai-provider.ts  OpenAI LLMProvider implementation
  rag/
    indexer.ts            Chunk, embed, upsert to ChromaDB
    retriever.ts          Similarity + MMR search
  read-models/
    selector-cache.ts     Cached selectors from successful resolutions
    tickets.ts            Ticket stats read model
    workflow-executions.ts Workflow execution read model
  recorder/
    cdp-recorder.ts       CDP event capture
    annotator.ts          LLM-based action annotation
    generator.ts          Workflow generation from recordings
    skill-generator.ts    Skill generation from workflows
    controller.ts         Recording orchestration
    cli.ts                Recording CLI commands
    types.ts              Recording types
    index.ts              Recorder exports
  skills/
    loader.ts             Skill discovery and loading
    types.ts              SkillManifest, SkillProvider, SkillFactory
    index.ts              Skills exports
  workflows/
    registry.ts           Workflow registry
    types.ts              WorkflowExecutor, WorkflowContext
    index.ts              Workflow exports
  cli.ts                  CLI entry point
demo/
  ticket-app/             Demo ticket management app (v1 + v2 layouts)
  run-recording-demo.ts   Recording demo script
  build-full-deck.js      PDF deck generator
test/
  e2e/                    End-to-end integration tests
```

---

## Stack

| Layer | Tech |
|---|---|
| Agent orchestration | LangGraph (StateGraph) |
| LLM + embeddings | OpenAI via LangChain |
| Vision | GPT-4o (screenshots + accessibility tree) |
| Vector store | ChromaDB |
| Browser automation | Playwright + Chrome CDP |
| Connectors | ServiceNow, Jira, GitLab (REST APIs) |
| Knowledge ingestion | Azure DevOps, Confluence, URL scraping, ticket mining |
| Code implementation | OpenAI, Anthropic, Google (multi-provider) |
| Event store | Custom ES/CQRS with aggregates and read models |
| Demo app | Express |
| Runtime | Node 18+ / TypeScript strict mode |

---

## License

MIT
