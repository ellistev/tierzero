Here's the practical getting-started guide for TierZero:

---

## Prerequisites

```bash
# 1. ChromaDB must be running first — always
docker run -p 8000:8000 chromadb/chroma

# 2. Copy and fill in your keys
cp .env.example .env
# Add: OPENAI_API_KEY, plus whichever connector you're using
```

---

## Step 1 — Build your knowledge base

You have four ways to populate `knowledge/`:

**Option A — Drop files manually**
Copy any `.md`, `.txt`, `.pdf` runbooks into `knowledge/` and run index.

**Option B — Pull from Azure DevOps** (your priority use case)
```bash
npm run dev -- import-wiki \
  --source azuredevops \
  --org myorg \
  --project MyProject \
  --token YOUR_PAT \
  --mode both        # imports wiki pages + mines resolved work items
```

**Option C — Pull from Confluence**
```bash
npm run dev -- import-wiki \
  --source confluence \
  --base-url https://myco.atlassian.net \
  --email you@myco.com \
  --api-token YOUR_TOKEN \
  --space-key IT,OPS
```

**Option D — Mine your existing resolved tickets**
```bash
npm run dev -- mine-tickets \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --limit 200 \
  --min-comments 1
```

**Then index whatever you imported:**
```bash
npm run index -- knowledge/
```

---

## Step 2 — Verify the knowledge base works

```bash
npm run dev -- search "VPN not connecting"
npm run dev -- search "password reset" --mmr --k 5
```

If you get good chunks back, you're ready. If not, check `--threshold` (lower it) or re-index with `--force`.

---

## Step 3 — Run the agent on a single ticket

```bash
# ServiceNow
npm run dev -- run INC0012345 \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --dry-run    # logs actions without actually posting comments

# Jira
npm run dev -- run PROJ-1234 \
  --connector jira \
  --base-url https://myco.atlassian.net \
  --email agent@myco.com \
  --api-token secret

# GitLab
npm run dev -- run 42 \
  --connector gitlab \
  --token glpat-xxxx \
  --project-id 123
```

The output shows the decision (`automate` / `draft_response` / `escalate` / `needs_info`), confidence score, and what action was taken.

---

## Step 4 — Run continuously (production mode)

```bash
npm run dev -- watch \
  --connector servicenow \
  --instance-url https://myco.service-now.com \
  --username svc-agent \
  --password secret \
  --interval 60 \     # poll every 60 seconds
  --batch-size 5 \    # max 5 tickets per cycle
  --dry-run           # remove this when confident
```

Ctrl+C to stop. Deduplication is built in — tickets already processed won't be re-run.

---

## The full loop

```
import sources → index → search to verify → run --dry-run → run live → watch
```

Start with `--dry-run` on a handful of real tickets to see how the agent reasons before letting it post comments on its own.