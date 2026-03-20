# TierZero

An autonomous agent framework that picks up tasks, writes code, runs tests, reviews PRs, deploys, and monitors itself. No human in the loop.

> **Tier 0** is the support level below Tier 1. Fully automated. No queue. No waiting.

---

## What is TierZero

TierZero is a self-operating software agent. It watches GitHub for labeled issues, writes the code to solve them using Claude Code, runs the test suite, opens a PR, reviews its own diff against configurable rules, auto-merges on approval, deploys to staging/production, and monitors the result. If something breaks, it alerts, escalates, and can roll back. It learns from every task it completes and stores reusable knowledge for future work. Input sources include GitHub issues, webhooks, and cron-scheduled jobs.

---

## Features

- **GitHub issue watcher** -- polls for labeled issues, resolves them end-to-end (branch, code, test, PR, merge)
- **Claude Code agent** -- uses Claude Code CLI as the coding agent (free via Max subscription)
- **Native code agent** -- multi-provider LLM coding (OpenAI, Anthropic, Google) with smart file selection
- **PR review gate** -- static rules + optional LLM review before merge (no-console-log, no-todo, no-secrets, test-coverage, etc.)
- **Review-fix loop** -- iterative review → auto-fix → re-review until the PR passes
- **Auto-merge** -- squash, merge, or rebase after review approval
- **Deployment pipeline** -- SSH/git/script strategies with health checks and automatic rollback
- **Orchestrator** -- central task router accepting work from GitHub, webhooks, and scheduled jobs
- **Agent supervisor** -- manages concurrent agents with heartbeat monitoring, timeout enforcement, and hung agent detection
- **Scheduler** -- cron-based job scheduling with timezone support and failure tracking
- **Monitoring dashboard** -- metrics collection, alert engine, health aggregator, REST API
- **Notifications** -- rule-based event routing to email, Slack, Discord, and webhooks
- **Knowledge persistence** -- extracts patterns and solutions from completed work for future reference
- **RAG knowledge base** -- index docs into ChromaDB, retrieve at runtime via similarity search
- **Ticket connectors** -- ServiceNow, Jira, GitLab, Freshdesk, GitHub, Zendesk
- **Browser automation** -- intent-based, self-healing via 5-strategy resolution chain (cached → aria → LLM → vision → coordinates)
- **Workflow recording** -- watch a human once, generate an adaptive skill
- **Event sourcing / CQRS** -- full audit trail, replay debugging, analytics read models
- **Security scanning** -- secret detection across files and git history

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/ellistev/tierzero.git
cd tierzero
npm install

# 2. Set your GitHub token
export GITHUB_TOKEN=ghp_...

# 3. Start the watcher (foreground)
npx tsx src/cli.ts watch-github \
  --owner ellistev --repo tierzero \
  --token $GITHUB_TOKEN \
  --interval 300 \
  --agent claude-code \
  --claude-timeout 900 \
  --auto-merge \
  --merge-method squash
```

Label a GitHub issue with `tierzero-agent` and the watcher picks it up, writes the code, opens a PR, reviews it, and merges. Issues are processed in priority order. Add a `priority-N` label (lower N = higher priority). Issues without priority labels are processed last, sorted by issue number.

---

## Architecture

```
Input Sources                        Event Bus
  GitHub Adapter ─┐                    │
  Webhook Adapter ─┼─► Task Router ────┼──► Notification Manager
  Scheduler ───────┘   (normalize,     │     (email, Slack, Discord, webhook)
                        prioritize,    │
                        route)         ├──► Metrics Collector
                          │            │     └─► Alert Engine
                          ▼            │          └─► Escalation
                    Agent Supervisor   │
                    (spawn, monitor,   ├──► Health Aggregator
                     heartbeat)        │     (router, agents, connectors,
                          │            │      notifications, scheduler)
                          ▼            │
                    Code Agent         ├──► Read Models
                    (Claude Code or    │     (tasks, agents, deployments,
                     native LLM)       │      notifications, scheduled-jobs)
                          │            │
                          ▼            └──► REST API
                    Issue Pipeline          /api/tasks, /api/agents,
                    branch → code →        /api/deployments, /api/scheduler,
                    test → PR →            /api/dashboard
                    review → merge →
                    deploy
```

**Agent pipeline (single ticket):**

```
START → ingest → retrieve → decide → act → record → END
```

| Node | Purpose |
|---|---|
| **ingest** | Load full context from connector |
| **retrieve** | RAG search knowledge base |
| **decide** | Structured LLM call -- decision + reasoning + confidence |
| **act** | Execute deterministically (resolve, respond, escalate, implement) |
| **record** | Post audit note with full run summary |

**Decision types:** `automate`, `draft_response`, `escalate`, `needs_info`, `implement`

---

## Running the Watcher

The watcher is the primary use case: poll GitHub for labeled issues and resolve them autonomously.

### Method 1: Direct (foreground)

Best for development, debugging, and seeing output in real time.

```bash
npx tsx src/cli.ts watch-github \
  --owner ellistev --repo tierzero \
  --token $GITHUB_TOKEN \
  --interval 300 \
  --agent claude-code \
  --claude-timeout 900 \
  --auto-merge \
  --merge-method squash
```

Press `Ctrl+C` to stop.

### Method 2: Detached Launcher (background)

Survives terminal closes and gateway crashes. Save this as `launch-watcher.cjs` in the project root:

```javascript
const { spawn } = require('child_process');
const fs = require('fs');
const logFile = process.env.TEMP + '/tierzero-watcher.log';
fs.writeFileSync(logFile, '');
const log = fs.openSync(logFile, 'a');

const child = spawn(process.execPath, [
  '--import', 'tsx',
  'src/cli.ts', 'watch-github',
  '--owner', 'ellistev', '--repo', 'tierzero',
  '--token', process.env.GITHUB_TOKEN,
  '--interval', '300',
  '--agent', 'claude-code',
  '--claude-timeout', '900',
  '--auto-merge', '--merge-method', 'squash'
], {
  cwd: __dirname,
  stdio: ['ignore', log, log],
  detached: true,
  windowsHide: true,
});
child.unref();
console.log('Watcher PID:', child.pid);
```

Run it:

```bash
node launch-watcher.cjs
```

Tail logs (PowerShell):

```powershell
Get-Content $env:TEMP\tierzero-watcher.log -Tail 20 -Wait
```

Tail logs (bash):

```bash
tail -f $TEMP/tierzero-watcher.log
```

---

## CLI Reference

All commands are invoked via `npx tsx src/cli.ts <command> [options]`.

### `watch-github`

Watch a GitHub repo and autonomously resolve labeled issues.

| Flag | Required | Default | Description |
|---|---|---|---|
| `--owner` | yes | -- | GitHub owner (org or user) |
| `--repo` | yes | -- | GitHub repository name |
| `--token` | yes | env `GITHUB_TOKEN` | GitHub personal access token |
| `--interval` | no | `60` | Poll interval in seconds |
| `--label` | no | `tierzero-agent` | Trigger label on issues |
| `--assign-to` | no | -- | Assign issues to this GitHub user |
| `--workdir` | no | cwd | Working directory / repo path |
| `--test-command` | no | `npm test` | Test command after edits |
| `--agent` | no | `native` | Agent type: `native` or `claude-code` |
| `--claude-path` | no | `claude` | Path to Claude CLI binary |
| `--claude-timeout` | no | `600` | Seconds per issue (Claude Code agent) |
| `--auto-merge` | no | `false` | Auto-merge PRs after review passes |
| `--merge-method` | no | `squash` | Merge strategy: `merge`, `squash`, `rebase` |

```bash
# Claude Code agent with auto-merge
npx tsx src/cli.ts watch-github \
  --owner myorg --repo myrepo \
  --token $GITHUB_TOKEN \
  --agent claude-code \
  --claude-timeout 900 \
  --auto-merge --merge-method squash

# Native agent with custom coding model
npx tsx src/cli.ts watch-github \
  --owner myorg --repo myrepo \
  --token $GITHUB_TOKEN \
  --coding-model claude-sonnet-4-20250514 \
  --interval 120
```

### `orchestrate`

Run the full orchestrator with multi-source input, agent supervision, scheduler, monitoring, and REST API.

| Flag | Required | Default | Description |
|---|---|---|---|
| `--config` | no | `orchestrator.json` | Path to orchestrator config file |

```bash
npx tsx src/cli.ts orchestrate --config config/orchestrator.json
```

See [Configuration Reference](#configuration-reference) for the config format.

### `run`

Run the agent on a single ticket.

| Flag | Required | Default | Description |
|---|---|---|---|
| `--instance-url` | yes | env `SERVICENOW_INSTANCE_URL` | Connector instance URL |
| `--username` | yes | env `SERVICENOW_USERNAME` | Connector username |
| `--password` | yes | env `SERVICENOW_PASSWORD` | Connector password |
| `--table` | no | `incident` | Table name (ServiceNow) or `jira`/`gitlab` |
| `--model` | no | `gpt-4o-mini` | LLM model for decisions |
| `--max-iterations` | no | `10` | Agent loop cap |
| `--dry-run` | no | `false` | Log actions without executing |
| `--codebase` | no | -- | Path to repo for code implementation |
| `--codebase-name` | no | folder name | Name for the codebase |
| `--test-command` | no | -- | Test command after edits |
| `--branch-prefix` | no | `tierzero/` | Git branch prefix |
| `--coding-model` | no | -- | Coding LLM (e.g. `claude-sonnet-4-20250514`, `gpt-4o`) |
| `--coding-provider` | no | auto-detected | Force provider: `openai`, `anthropic`, `google` |
| `--coding-api-key` | no | provider env var | API key for coding LLM |

```bash
# Dry run on a ServiceNow ticket
npx tsx src/cli.ts run INC0012345 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --dry-run

# With code implementation
npx tsx src/cli.ts run BUG-1234 \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --codebase ./my-project \
  --coding-model claude-sonnet-4-20250514 \
  --test-command "npm test"
```

### `watch`

Continuous polling loop for ServiceNow/Jira/GitLab tickets. Accepts all `run` flags plus:

| Flag | Required | Default | Description |
|---|---|---|---|
| `--interval` | no | `60` | Poll interval in seconds |
| `--batch-size` | no | unlimited | Max tickets per cycle |
| `--max-tickets` | no | run forever | Stop after N total tickets |

```bash
npx tsx src/cli.ts watch \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --interval 60 \
  --batch-size 5
```

### `index`

Index a folder of documents into ChromaDB for RAG retrieval.

| Flag | Required | Default | Description |
|---|---|---|---|
| `--chunk-size` | no | `1000` | Characters per chunk |
| `--chunk-overlap` | no | `200` | Overlap between chunks |
| `--force` | no | `false` | Re-index all files, ignore change detection |
| `--stats` | no | `false` | Print index stats without re-indexing |

```bash
npx tsx src/cli.ts index ./knowledge/
npx tsx src/cli.ts index ./knowledge/ --force --stats
```

### `search`

Test RAG retrieval from the knowledge base.

| Flag | Required | Default | Description |
|---|---|---|---|
| `--k` | no | `5` | Number of results |
| `--threshold` | no | `0.5` | Min similarity score (0-1) |
| `--folder` | no | -- | Restrict to source prefix |
| `--mmr` | no | `false` | Use Maximal Marginal Relevance for diverse results |

```bash
npx tsx src/cli.ts search "VPN not connecting"
npx tsx src/cli.ts search "password reset" --folder runbooks/ --k 3 --mmr
```

### `import-wiki`

Import documentation from Azure DevOps or Confluence.

```bash
# Azure DevOps
npx tsx src/cli.ts import-wiki \
  --source azuredevops \
  --org myorg --project MyProject \
  --token $AZUREDEVOPS_TOKEN \
  --mode both

# Confluence
npx tsx src/cli.ts import-wiki \
  --source confluence \
  --base-url https://myco.atlassian.net/wiki \
  --email admin@myco.com \
  --api-token secret \
  --space-key IT,OPS
```

### `mine-tickets`

Turn resolved tickets into knowledge articles.

| Flag | Required | Default | Description |
|---|---|---|---|
| `--connector` | yes | -- | `servicenow`, `jira`, `gitlab`, or `freshdesk` |
| `--limit` | no | `100` | Max tickets to mine |
| `--min-comments` | no | `1` | Quality gate |
| `--since` | no | -- | Only tickets updated after this ISO date |
| `--output` | no | `knowledge` | Output directory |

```bash
npx tsx src/cli.ts mine-tickets \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent --password secret \
  --limit 200 --since 2025-01-01
```

### `import-url`

Scrape URLs into the knowledge base.

| Flag | Required | Default | Description |
|---|---|---|---|
| `--output` | no | `knowledge` | Output directory |
| `--ignore-robots` | no | `false` | Skip robots.txt check |
| `--timeout` | no | `15000` | Fetch timeout in ms |

```bash
npx tsx src/cli.ts import-url \
  https://docs.myco.com/runbooks/vpn \
  https://docs.myco.com/runbooks/printer \
  --output knowledge/scraped
```

---

## Configuration Reference

The `orchestrate` command reads a JSON config file. Below is a complete example with all supported fields.

```jsonc
{
  // --- Adapters: where tasks come from ---
  "adapters": {
    "github": {
      "owner": "myorg",
      "repo": "myrepo",
      "token": "ghp_...",            // or set GITHUB_TOKEN env var
      "label": "tierzero-agent",     // trigger label (default: tierzero-agent)
      "interval": 180                // poll interval in seconds (default: 180)
    },
    "webhook": {
      "port": 3500                   // HTTP port for webhook receiver
    }
  },

  // --- Agents: who does the work ---
  "agents": {
    "claude-code": {
      "type": "claude-code",
      "capabilities": ["code", "test", "review"],
      "maxConcurrent": 1
    }
  },

  // --- Claude Code settings ---
  "claude": {
    "path": "claude",               // path to Claude CLI binary
    "timeoutMs": 900000             // timeout per task (default: 900000 = 15 min)
  },

  // --- Concurrency and timeouts ---
  "maxConcurrent": 3,               // max total agents across all types
  "taskTimeoutMs": 900000,          // global task timeout in ms
  "testCommand": "npm test",        // test command for code agents

  // --- Scheduler: cron-triggered tasks ---
  "scheduler": {
    "timezone": "America/Los_Angeles",
    "jobs": [
      {
        "id": "custom-check",
        "name": "Custom Health Check",
        "schedule": "*/30 * * * *",  // cron expression
        "taskTemplate": {
          "title": "Custom check",
          "description": "Run periodic health check",
          "category": "monitoring",  // monitoring | code | operations | communication | research
          "priority": "normal",      // critical | high | normal | low
          "agentType": "claude-code"
        },
        "enabled": true,
        "maxConsecutiveFailures": 5
      }
    ]
  },

  // --- Deployment: staging and production ---
  "deploy": {
    "staging": {
      "strategy": "direct",         // direct (SSH) | docker | kubernetes
      "host": "staging.example.com",
      "user": "deploy",
      "keyPath": "~/.ssh/deploy_key",
      "remotePath": "/opt/myapp",
      "pm2AppName": "myapp-staging",
      "healthCheckUrl": "https://staging.example.com/health",
      "healthCheckTimeoutMs": 30000,
      "rollbackOnFailure": true
    },
    "production": {
      "strategy": "direct",
      "host": "prod.example.com",
      "user": "deploy",
      "keyPath": "~/.ssh/deploy_key",
      "remotePath": "/opt/myapp",
      "pm2AppName": "myapp",
      "healthCheckUrl": "https://example.com/health",
      "healthCheckTimeoutMs": 60000,
      "rollbackOnFailure": true
    }
  },

  // --- PR Review gate ---
  "prReview": {
    "enabled": true,
    "minScore": 70,                  // minimum review score (0-100) to pass
    "maxErrors": 0,                  // max errors allowed
    "maxWarnings": 5,                // max warnings allowed
    "useLLM": false,                 // enable LLM-based review (in addition to static rules)
    "rules": [                       // which static rules to run
      "no-console-log",
      "no-todo",
      "test-coverage",
      "no-any",
      "file-size",
      "no-secrets"
    ]
  },

  // --- Knowledge persistence ---
  "knowledge": {
    "enabled": true                  // extract and store knowledge from completed tasks
  },

  // --- REST API ---
  "apiPort": 3500                    // port for the monitoring/management API
}
```

### REST API Endpoints

When running `orchestrate`, the following endpoints are available:

| Endpoint | Description |
|---|---|
| `GET /api/tasks` | List all tasks in the queue |
| `POST /api/tasks` | Submit a new task |
| `GET /api/agents` | List all agent processes |
| `GET /api/scheduler/jobs` | List scheduled jobs |
| `POST /api/scheduler/jobs/:id/trigger` | Manually trigger a job |
| `GET /api/dashboard/health` | System health status |
| `GET /api/dashboard/metrics` | Collected metrics |
| `GET /api/dashboard/alerts` | Active alerts |
| `GET /api/deployments` | Deployment history |

---

## Contributing

### Adding a New Connector

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

### Adding a New Agent Type

1. Create an executor function matching the `AgentExecutor` signature in `src/orchestrator/agent-executor.ts`
2. Register it in the agent registry via `orchestrator.json` config
3. The supervisor handles lifecycle (heartbeat, timeout, cleanup) automatically

### Adding Review Rules

Add a new rule to `src/workflows/review-rules.ts`:

```typescript
{
  id: "my-rule",
  name: "My Custom Rule",
  severity: "error",  // "error" or "warning"
  check(files: ReviewFile[]): ReviewFinding[] {
    // Analyze diff hunks, return findings
  }
}
```

Then add `"my-rule"` to the `prReview.rules` array in your orchestrator config.

### Adding Notification Channels

Implement the `CommChannel` interface in `src/comms/channels/`:

```typescript
import type { CommChannel } from './types';

class MyChannel implements CommChannel {
  readonly name = "my-channel";
  async send(message: { subject: string; body: string; metadata?: Record<string, unknown> }) { ... }
}
```

Register it with the `NotificationManager` and add routing rules.

### Test Conventions

- Test runner: `node:test` (`import { describe, it } from 'node:test'`)
- Assertions: `node:assert/strict`
- Run all tests: `npm test`
- TypeScript check: `npx tsc --noEmit`

---

## Environment Variables

```env
# Required for watch-github
GITHUB_TOKEN=ghp_...

# Required for RAG (knowledge base)
OPENAI_API_KEY=sk-...
CHROMA_URL=http://localhost:8000        # default
CHROMA_COLLECTION=knowledge             # default

# Connector-specific (as needed)
SERVICENOW_INSTANCE_URL=https://myco.service-now.com
SERVICENOW_USERNAME=svc-agent
SERVICENOW_PASSWORD=secret
JIRA_BASE_URL=https://myco.atlassian.net
JIRA_EMAIL=agent@myco.com
JIRA_API_TOKEN=secret
JIRA_PROJECT_KEY=IT
GITLAB_BASE_URL=https://gitlab.myco.com
GITLAB_TOKEN=glpat-xxxx
GITLAB_PROJECT_ID=42

# Coding model (for native agent)
CODING_MODEL=claude-sonnet-4-20250514
CODING_API_KEY=sk-ant-...
```

---

## Testing

```bash
npm test              # Unit tests (~2s)
npx tsc --noEmit      # TypeScript strict mode
npm run test:e2e      # End-to-end integration tests
npm run security:check # Secret scanner
```

---

## License

MIT
