# Task: Build Demo Environment for TierZero

## Context
TierZero is an AI agent that reads support tickets from systems like ServiceNow, uses RAG to find relevant runbooks/procedures, then autonomously decides how to handle each ticket. We need a working demo showing TierZero resolving real-looking ServiceNow tickets using knowledge from runbooks.

## What Exists
- Full agent pipeline in `src/agent/agent.ts` (LangGraph: ingest -> retrieve -> decide -> act -> record)
- ServiceNow connector in `src/connectors/servicenow.ts` (uses REST API)
- RAG indexer/retriever in `src/rag/` (ChromaDB + OpenAI embeddings)
- Knowledge base runbooks in `knowledge/runbooks/` including SGI-specific procedures
- CLI in `src/cli.ts` with index/search/run/watch commands
- `.env` has OPENAI_API_KEY set

## What to Build

### 1. Mock ServiceNow Server (`demo/mock-servicenow.ts`)
A lightweight Express server that implements the ServiceNow REST API endpoints that `src/connectors/servicenow.ts` calls:
- `GET /api/now/table/incident` - list incidents
- `GET /api/now/table/incident/:sys_id` - get single incident  
- `GET /api/now/table/sys_journal_field` - get comments
- `PATCH /api/now/table/incident/:sys_id` - add comment (work_notes or comments field)
- `GET /api/now/attachment` - list attachments
- `GET /api/now/attachment/:id/file` - download attachment
- `POST /api/now/attachment/file` - upload attachment

Pre-populate with 5-8 realistic tickets:
1. **Bind Failure ticket** - DRIVE Alerts, description has JSON with "Cannot access payment info" error and JobNumber. Has JSON attachment with requote response containing new job number. Should match the sgi-requote-rebind runbook.
2. **Password reset request** - user locked out, should match password-reset runbook
3. **VPN connectivity issue** - user can't connect to VPN, should match vpn-troubleshooting runbook
4. **Disk space alert** - server running low on disk, should match disk-cleanup runbook
5. **Vague ticket with no detail** - "it's broken" with no useful info, agent should request more info
6. **Hardware failure** - physical server issue, agent should escalate (no runbook covers physical access)

Each ticket needs: sys_id, number (INCxxxxxxx), short_description, description, state, priority, caller_id, assigned_to, assignment_group, sys_created_on, sys_updated_on, sys_class_name.

The mock should:
- Support `sysparm_display_value=all` format (each field is `{value: "...", display_value: "..."}`)
- Support `X-Total-Count` header for pagination
- Support basic auth (any username/password)
- Log all requests for demo visibility
- Store comments in memory so the agent's comments persist during the demo

### 2. Demo Runner Script (`demo/run-demo.ts`)
A script that:
1. Starts the mock ServiceNow server on port 8888
2. Starts ChromaDB via Docker (or checks if running)
3. Indexes the knowledge base
4. Runs the agent against each ticket in sequence with `--dry-run` first, then real mode
5. Shows a clear, colorful summary of what happened to each ticket
6. Supports recording output to a file for demo purposes

### 3. Package.json Updates
Add scripts:
- `demo:server` - start mock ServiceNow
- `demo` - run the full demo
- `demo:dry` - run demo in dry-run mode

### 4. .env.example Updates
Add demo ServiceNow credentials section.

## Technical Requirements
- Use Express for the mock server (add to devDependencies)
- TypeScript, runs via tsx
- The mock must return data in the EXACT format ServiceNowConnector expects
- Look at `src/connectors/servicenow.ts` carefully - it uses `sysparm_display_value=all` which means every field comes back as `{value: "...", display_value: "..."}`
- The mock tickets should have realistic descriptions that will actually match the runbooks via RAG
- Include the JSON attachment content inline in the mock for the bind failure ticket

## Important Notes
- The OPENAI_API_KEY in `.env` is real and works - use it for testing
- ChromaDB needs to be running on localhost:8000
- The agent uses `gpt-4o-mini` by default which is fast and cheap
- Run `npx tsc --noEmit` to verify no type errors
- Run `npm test` to verify existing tests still pass
- Don't break any existing functionality
