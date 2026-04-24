# Current Task - TierZero Ralph Loop

## Task
Start Issue 3 for TierZero memory/context: add structured ticket run records so every handled task leaves behind replayable episodic memory.

## Why this is the top task
Issue 2 is now landed: knowledge entries can carry tenant/workflow/queue scope, retrieval filters and ranks by scope, incompatible tenant memory is excluded, and orchestrator threads scope from task context into both recall and write-back. The next missing layer is episodic case memory. Right now TierZero can remember reusable lessons better, but it still cannot replay prior ticket runs as structured cases.

## Inputs
- `RALPH_LOOP.md`
- `IMPLEMENTATION_PLAN.md`
- `MEMORY_CONTEXT_ISSUE_SEQUENCE.md`
- `MEMORY_CONTEXT_GITHUB_ISSUES.md`
- `KNOWLEDGE_STORE_DESIGN.md`
- `src/knowledge/store.ts`
- `src/knowledge/factory.ts`
- `src/knowledge/chroma-store.ts`
- `src/cli.ts`
- `src/cli/config-validator.ts`

## Deliverable
Advance Issue 3 from design into the first working structured run-record path.

At minimum, the next pass should:
- define a durable run-record model for handled tasks/tickets
- persist success, failure, and escalation outcomes
- capture workflow, scope, retrieved context ids, actions, and timestamps
- make the record queryable enough to support later similar-case recall

## Acceptance criteria
- Each handled task emits a structured run record
- Run records include success, failure, and escalation outcomes
- Run records carry workflow and tenant/customer scope when available
- The repo state makes the next Issue 4 extraction upgrade obvious

## Validation
- `npm run typecheck` if repo-wide baseline is green enough to trust
- targeted orchestrator/domain/read-model tests for run records
- full `npm test` before claiming the task done

## After completion
Update:
- `IMPLEMENTATION_PLAN.md`
- this file to the next single task after Issue 3 is genuinely landed
