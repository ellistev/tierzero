# CLAUDE.md

## What is TierZero

TierZero is an autonomous agent framework. It watches GitHub for labeled issues, writes code to solve them (via Claude Code CLI or native multi-provider LLM), runs tests, opens PRs, reviews diffs against configurable rules, auto-merges, deploys, and monitors the result. It also supports ServiceNow/Jira/GitLab/Freshdesk ticket resolution with RAG-powered knowledge lookup and browser automation.

## Code Navigation
- Prefer LSP over grep/glob for code navigation (go-to-definition, find references, type checking)
- LSP gives exact results in ~50ms vs grep's fuzzy multi-file guessing

## Context Hub (chub) - Up-to-date API Docs
When working with external libraries, use `chub` to get current API documentation instead of relying on training data:

```bash
chub search "playwright"
chub get playwright/playwright
chub get langchain/core
chub get langgraph/package
chub get openai/chat
chub get chromadb/package
```

Always `chub get <id>` before writing code that uses an unfamiliar API.

## Project Stack
- **Runtime:** Node 18+ / TypeScript strict
- **Agent:** LangGraph StateGraph
- **LLM:** OpenAI (GPT-4o/mini) via LangChain
- **Vector store:** ChromaDB
- **Browser:** Playwright + Chrome CDP
- **Test runner:** Node built-in (`import { describe, it } from 'node:test'`)
- **Assertions:** `import assert from 'node:assert/strict'`
- **No new dependencies** without explicit approval

## Architecture Overview

```
Input Sources (GitHub, Webhook, Schedule)
  -> Task Router (normalize, prioritize, route)
    -> Agent Supervisor (spawn, monitor, heartbeat)
      -> Claude Code Agent or Native LLM Agent
    -> Issue Pipeline (branch, code, test, review, PR, merge, deploy)
  -> Event Bus
    -> Notification Manager (email, Slack, Discord, webhook)
    -> Metrics Collector -> Alert Engine -> Escalation
    -> Health Aggregator
    -> Read Models (tasks, agents, deployments, notifications, scheduled-jobs)
  -> REST API (/api/tasks, /api/agents, /api/dashboard, /api/scheduler, /api/deployments)
```

## Key Subsystems and Locations

| Subsystem | Path | Purpose |
|---|---|---|
| CLI entry point | `src/cli.ts` | All commands (watch-github, orchestrate, run, watch, index, search, etc.) |
| Agent graph | `src/agent/agent.ts` | LangGraph StateGraph (ingest → retrieve → decide → act → record) |
| Orchestrator | `src/orchestrator/` | Task router, agent supervisor, agent registry, concurrency manager |
| Issue pipeline | `src/workflows/issue-pipeline.ts` | Branch → code → test → PR → review → merge → deploy |
| Claude Code agent | `src/workflows/claude-code-agent.ts` | Claude Code CLI wrapper |
| PR review | `src/workflows/pr-reviewer.ts`, `review-rules.ts`, `review-fix-loop.ts` | Static + LLM review, auto-fix loop |
| Deployment | `src/deploy/` | Pipeline, SSH/git/script strategies, health checker |
| Monitoring | `src/monitoring/` | Metrics, alerts, health aggregator, escalation |
| Scheduler | `src/scheduler/` | Cron jobs, timezone support, built-in jobs |
| Notifications | `src/comms/` | Notification manager, channels, templates |
| Knowledge | `src/knowledge/` | Extractor, store, Claude Code integration |
| RAG | `src/rag/` | Indexer (ChromaDB), retriever (similarity + MMR) |
| Connectors | `src/connectors/` | ServiceNow, Jira, GitLab, Freshdesk, GitHub, Zendesk |
| Browser | `src/browser/`, `src/intents/` | Chrome CDP, IntentEngine (5-strategy resolution) |
| Recorder | `src/recorder/` | Workflow recording, annotation, skill generation |
| Domain models | `src/domain/` | Event-sourced aggregates (Ticket, Task, AgentProcess, etc.) |
| Read models | `src/read-models/` | Projections (tasks, agents, deployments, notifications, etc.) |
| Event bus | `src/infra/event-bus.ts` | Central event bus connecting all subsystems |
| REST API | `src/infra/rest/` | Express routers for tasks, agents, scheduler, dashboard, deployments |
| Security | `src/security/` | Secret scanner, pre-commit check |
| Config | `config/orchestrator.json` | Orchestrator config (deploy, prReview, scheduler, agents, adapters) |

## Conventions
- All tests co-located with source (`*.test.ts` next to implementation)
- Event sourcing: aggregates in `src/domain/`, read models in `src/read-models/`
- Connectors implement `TicketConnector` interface (7 methods)
- Review rules in `src/workflows/review-rules.ts` (id, name, severity, check function)
- Notification channels implement `CommChannel` interface
- Skills are hot-loadable modules in `skills/` with `skill.json` + `index.ts`
