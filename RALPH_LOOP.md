# TierZero Ralph Loop

## Objective
Turn TierZero into a sellable overnight service desk queue-clearance business, not just a clever repo.

## Rule of the loop
One task per iteration.
Progress lives in repo files and git, not chat.
Every iteration must leave behind a durable artifact.

## Files of truth
- `IMPLEMENTATION_PLAN.md` - business direction and queue
- `CURRENT_TASK.md` - exactly one active task
- `go-to-market/` - buyer-facing assets
- `ROADMAP.md` - product/platform roadmap
- git history / issues / PRs - execution record

## Current lane
**Wedge:** Overnight service desk queue clearance

**First workflow:** Password reset / account unlock for standard employee accounts

**Active execution track:** Memory/context moat foundation

**Current priority order:**
1. Finish Issue 1 - durable KnowledgeStore for orchestrator
2. Issue 2 - tenant/workflow-scoped retrieval
3. Issue 3 - structured ticket run records

## Done definition for each loop
1. The active task has a clear artifact in the repo
2. The artifact is specific enough for the next session to continue cold
3. `CURRENT_TASK.md` is advanced to the next single task
4. `IMPLEMENTATION_PLAN.md` reflects the new state
5. If code changed, run validation before claiming done

## Anti-drift rules
- Do not widen the wedge mid-loop
- Do not optimize internal agent plumbing forever while GTM stays vague
- Do not batch multiple top tasks into one pass
- If the loop stalls, improve the repo contract, not the chat explanation

## Resume protocol
On resume:
1. Read `RALPH_LOOP.md`
2. Read `CURRENT_TASK.md`
3. Read only the files named there
4. Execute one task
5. Update the files of truth
