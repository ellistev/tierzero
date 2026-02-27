# TierZero — Getting Started

## Prerequisites

```bash
# ChromaDB must be running first — always
docker run -p 8000:8000 chromadb/chroma

# Copy and fill in your keys
cp .env.example .env
# Required: OPENAI_API_KEY
# Add whichever connector you're using (see .env.example for all variables)
```

---

## Step 1 — Build your knowledge base

Pick one or more sources to populate the `knowledge/` folder.

### Option A — Drop files manually

Copy any `.md`, `.txt`, or `.pdf` runbooks/SOPs into `knowledge/` and skip to the index step.

### Option B — Azure DevOps (wiki + resolved work items)

```bash
npm run dev -- import-wiki \
  --source azuredevops \
  --org myorg \
  --project MyProject \
  --token YOUR_PAT \
  --mode both
  # --mode wiki        import wiki pages only
  # --mode workitems   mine resolved work items only
  # --mode both        (default) do both
```

Wiki pages are stored as markdown natively — no conversion needed. Work items become "Problem → Resolution" articles.

### Option C — Confluence

```bash
npm run dev -- import-wiki \
  --source confluence \
  --base-url https://myco.atlassian.net \
  --email you@myco.com \
  --api-token YOUR_TOKEN \
  --space-key IT,OPS   # comma-separated; omit to import all spaces
```

### Option D — Arbitrary URLs

```bash
npm run dev -- import-url \
  https://docs.myco.com/runbooks/password-reset \
  https://docs.myco.com/runbooks/vpn-setup \
  --output knowledge/scraped
```

Fetches HTML pages and converts them to markdown. Respects `robots.txt` by default (`--ignore-robots` to override).

### Option E — Mine your existing resolved tickets

Turn your closed ticket history into knowledge articles:

```bash
# ServiceNow
npm run dev -- mine-tickets \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --limit 200 \
  --min-comments 1

# Jira
npm run dev -- mine-tickets \
  --connector jira \
  --base-url https://myco.atlassian.net \
  --email agent@myco.com \
  --api-token secret \
  --project-key ITSM

# GitLab
npm run dev -- mine-tickets \
  --connector gitlab \
  --base-url https://gitlab.myco.com \
  --token glpat-xxxx \
  --project-id 123
```

`--min-comments` is a quality gate — tickets with fewer comments than this are skipped.
`--since 2025-01-01` limits to tickets updated after a date.

### Index everything

After any import, run:

```bash
npm run index -- knowledge/

# Options:
npm run index -- knowledge/ --force          # re-index all files, even unchanged ones
npm run index -- knowledge/ --stats          # see what's currently indexed
npm run index -- knowledge/ --chunk-size 800 # tune chunk size (default 1000)
```

---

## Step 2 — Verify the knowledge base

Search without running the agent to confirm retrieval is working:

```bash
npm run dev -- search "VPN not connecting"
npm run dev -- search "password reset" --k 5
npm run dev -- search "disk full" --mmr --folder runbooks/
```

If results look thin, try lowering `--threshold` (default 0.5) or broadening the query. If results look good, move on.

---

## Step 3 — Run the agent on a single ticket

```bash
# ServiceNow
npm run dev -- run INC0012345 \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --dry-run

# Jira
npm run dev -- run PROJ-1234 \
  --connector jira \
  --base-url https://myco.atlassian.net \
  --email agent@myco.com \
  --api-token secret

# GitLab
npm run dev -- run 42 \
  --connector gitlab \
  --base-url https://gitlab.myco.com \
  --token glpat-xxxx \
  --project-id 123
```

`--dry-run` logs what the agent *would* do without posting any comments or changing ticket state. Always start here.

The output shows:
- **Decision**: `automate` | `draft_response` | `escalate` | `needs_info`
- **Confidence**: 0.0–1.0 (below 0.7 auto-escalates regardless of decision)
- **Action taken**: what was posted or updated
- **Steps**: the full reasoning chain

---

## Step 4 — Continuous mode (production)

Once you're confident in single-ticket results, run the polling loop:

```bash
npm run dev -- watch \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --interval 60 \
  --batch-size 5 \
  --dry-run
```

Remove `--dry-run` when ready to go live. Press Ctrl+C to stop.

| Option | Default | Description |
|---|---|---|
| `--interval` | 60 | Seconds between polls |
| `--batch-size` | unlimited | Max tickets processed per cycle |
| `--max-tickets` | unlimited | Stop after N total tickets |

Deduplication is built in — tickets already processed in a session won't be re-run.

---

## The full workflow

```
1. Import sources  →  knowledge/wiki/, knowledge/work-items/, knowledge/mined/ etc.
2. npm run index   →  chunks + embeds into ChromaDB
3. search          →  verify retrieval looks right
4. run --dry-run   →  validate agent decisions on real tickets
5. run (live)      →  confirm it posts correctly on one ticket
6. watch           →  continuous production mode
```

---

## Connector quick reference

| Connector | Auth | Key env vars |
|---|---|---|
| ServiceNow | Basic (username + password) | `SERVICENOW_INSTANCE_URL`, `SERVICENOW_USERNAME`, `SERVICENOW_PASSWORD` |
| Jira | Basic (email + API token) | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` |
| GitLab | `PRIVATE-TOKEN` header | `GITLAB_BASE_URL`, `GITLAB_TOKEN`, `GITLAB_PROJECT_ID` |

---

## Troubleshooting

**"Cannot connect to ChromaDB"** — ChromaDB isn't running. Run `docker run -p 8000:8000 chromadb/chroma`.

**"No results above threshold"** — Your knowledge base may not have relevant content, or the threshold is too high. Try `--threshold 0.3` or import more sources.

**Agent always escalates** — Confidence is falling below the threshold (default 0.7). Either the knowledge base doesn't cover the ticket topics well, or the ticket descriptions are too vague. Mine more resolved tickets or lower `--confidence-threshold`.

**Jira status changes not sticking** — Jira uses "transitions" for status changes. The connector tries to match transition names fuzzy; if your project uses custom transition names, check `DEFAULT_TRANSITION_NAMES` in `src/connectors/jira.ts`.
