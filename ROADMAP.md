# TierZero Roadmap

## Vision

TierZero builds itself. The system that resolves tickets IS the system being improved by tickets.

## Phase 1: Core Agent -- COMPLETE

- [x] LangGraph StateGraph agent pipeline (ingest → retrieve → decide → act → record)
- [x] RAG knowledge base with ChromaDB (indexing, search, MMR)
- [x] Decision engine (automate, draft_response, escalate, needs_info, implement)
- [x] Ticket connectors (ServiceNow, Jira, GitLab, Freshdesk, GitHub, Zendesk)
- [x] Safety rails (security escalation, confidence thresholds, already-tried detection)
- [x] Knowledge ingestion (Azure DevOps, Confluence, URL scraping, ticket mining)

## Phase 2: Browser Automation -- COMPLETE

- [x] IntentEngine with 5-strategy resolution chain (cached → aria → LLM → vision → coordinates)
- [x] Recovery strategies (dialog dismissal, LLM recovery, page state assertions)
- [x] Workflow recording (CDP recorder → annotator → generator → skill generator)
- [x] Skills system (hot-loadable, manifest-driven)

## Phase 3: Code Implementation -- COMPLETE

- [x] Multi-provider coding models (OpenAI, Anthropic, Google, OpenRouter)
- [x] Smart file selection for LLM context
- [x] Git workflow (branch, commit, push, test)
- [x] GitHub issue watcher with native and Claude Code agents

## Phase 4: Event Sourcing / CQRS -- COMPLETE

- [x] Domain aggregates (Ticket, AgentProcess, Task, WorkflowExecution, ScheduledJob, Notification, Knowledge)
- [x] Read models (tasks, agents, deployments, notifications, scheduled-jobs, selector-cache)
- [x] Central event bus connecting all subsystems

## Phase 5: Orchestration -- COMPLETE

- [x] Task router (normalize, prioritize, route, retry)
- [x] Agent supervisor (spawn, heartbeat, timeout, hung detection, cleanup)
- [x] Agent registry and executor factory
- [x] Concurrency manager (token bucket)
- [x] GitHub adapter, webhook adapter, schedule adapter

## Phase 6: Scheduling, Monitoring, Notifications -- COMPLETE

- [x] Cron-based scheduler with timezone support and built-in jobs
- [x] Metrics collector, alert engine, health aggregator
- [x] Notification manager with rule-based routing (email, Slack, Discord, webhook)
- [x] Escalation logic

## Phase 7: Deployment + PR Review -- COMPLETE

- [x] Deployment pipeline (deploy → health check → rollback)
- [x] SSH, git, and script deployment strategies
- [x] PR reviewer (static rules + optional LLM review)
- [x] Review-fix-resolve loop (iterative auto-fix until approval)

## Phase 8: Integration + Hardening -- COMPLETE

- [x] Wire all subsystems into orchestrator (scheduler, monitoring, deploy, notifications)
- [x] Security audit (secret scanner for files + git history)
- [x] REST API (tasks, agents, scheduler, dashboard, deployments, notifications)
- [x] Documentation rewrite (README, ROADMAP, CLAUDE.md)

## The Self-Improvement Loop

```
GitHub Issue created
  -> TierZero picks it up
  -> writes code + tests
  -> reviews its own PR
  -> auto-merges on approval
  -> deploys and monitors
  -> TierZero is now better
  -> repeat
```

## Next Steps

- [ ] Persistent event store (KurrentDB / PostgreSQL) replacing in-memory stores
- [ ] Web dashboard UI for monitoring and task management
- [ ] Multi-repo support (watch and work across multiple repositories)
- [ ] Plugin system for custom adapters and agents
- [ ] Webhook-driven GitHub integration (replace polling with GitHub App webhooks)
- [ ] Parallel agent execution for independent tasks
- [ ] Cost tracking and budget controls for LLM usage
- [ ] SaaS dashboard for monitoring agent work
- [ ] Landing page + marketing site
