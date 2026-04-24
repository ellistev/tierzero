# Current Task - TierZero Ralph Loop

## Task
Land Issue 3 for TierZero memory/context: add structured task/ticket run records so every handled run leaves behind replayable episodic memory.

## Resume exactly here
1. Read `RALPH_LOOP.md`
2. Read this file
3. Read `IMPLEMENTATION_PLAN.md`
4. Read `MEMORY_CONTEXT_ISSUE_SEQUENCE.md`
5. Then inspect these code anchors before changing anything:
   - `src/orchestrator/agent-executor.ts`
   - `src/orchestrator/supervisor.ts`
   - `src/read-models/task-queue.ts`
   - `src/orchestrator/task-adapter.ts`
   - `src/domain/task/`
   - `src/infra/rest/run-artifacts-router.ts`

## Why this is the top task
Issue 1 and Issue 2 are landed. TierZero now has:
- durable/semi-durable knowledge store wiring in orchestrator mode
- tenant/workflow/queue-scoped recall and write-back
- a real integration harness for the memory/context path
- a Codex-backed artifact viewer so input docs, knowledge, and output are inspectable

That is useful, but it is still not episodic memory.
The next compounding layer is structured run history: one queryable case record per handled run.

## Important current state
Treat these as already-landed foundation, not the next task:
- Issue 1 durable knowledge-store path
- Issue 2 scoped retrieval/write-back
- `test/e2e/memory-context-integration.e2e.test.ts`
- Codex managed-agent path and demo harness
- run-artifact viewer for inspection (`/run-artifacts`)

The viewer is for observability and demos. It does **not** satisfy Issue 3 by itself.
Issue 3 is about durable structured run records that later retrieval can query.

## Inputs
- `RALPH_LOOP.md`
- `IMPLEMENTATION_PLAN.md`
- `MEMORY_CONTEXT_ISSUE_SEQUENCE.md`
- `MEMORY_CONTEXT_GITHUB_ISSUES.md`
- `KNOWLEDGE_STORE_DESIGN.md`
- `src/orchestrator/agent-executor.ts`
- `src/orchestrator/supervisor.ts`
- `src/read-models/task-queue.ts`
- `src/orchestrator/task-adapter.ts`
- `src/knowledge/store.ts`
- `src/infra/rest/run-artifacts-router.ts`

## Deliverable
Advance Issue 3 from plan to first working implementation.

At minimum, the next pass should:
- define a structured run-record model for handled tasks/tickets
- persist completed, failed, killed/hung, and escalated outcomes
- capture workflow, scope, retrieved context ids, actions/decision summary, and timestamps
- make the record queryable enough to support later similar-case recall

## Recommended implementation shape
Follow the standard TierZero/OpenClaw pattern:
1. define the domain/read-model contract first
2. wire event emission from the orchestrator terminal states
3. persist/query records through a narrow store interface
4. add the smallest REST/query surface only if it helps validation
5. validate with targeted tests, then full suite

Do **not** start with UI polish.
Do **not** overbuild graph features yet.
Do **not** chase unrelated typecheck cleanup unless it blocks Issue 3 directly.

## Acceptance criteria
- Each handled task emits a structured run record
- Records include success, failure, killed/hung, and escalation outcomes
- Records carry tenant/customer + workflow scope when available
- Records capture retrieved context ids or an explicit placeholder for that field
- The repo state makes Issue 4 extraction upgrades obvious

## Validation
- targeted tests around orchestrator/domain/read-model behavior for run records
- targeted API/store tests if a query surface is added
- full `npm test` before claiming done
- `npm run typecheck` only if the repo-wide baseline is trustworthy enough; otherwise note the existing blocker and move on

## Known-good commands
- Run the Codex demo artifacts: `npx tsx demo/run-codex-memory-demo.ts`
- Start a clean local viewer/orchestrator: `npx tsx src/cli.ts orchestrate --config orchestrator.run-artifacts.json --skip-health-check`
- Working viewer URL in this environment: `http://localhost:3501/run-artifacts`
- Do **not** assume `http://localhost:3500` is TierZero here; another local `node server.js` is using that port right now

## After completion
Update:
- `IMPLEMENTATION_PLAN.md`
- `RALPH_LOOP.md` if the priority order changes
- this file to the next single active task only after Issue 3 is genuinely landed
