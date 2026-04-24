# TierZero Memory + Context Integration Test Plan

## Goal
Prove that the current memory/context work behaves as one integrated system instead of a pile of isolated unit tests.

## Environment under test
- Webhook adapter as a generic ticket-system ingress
- TaskRouter + AgentRegistry
- AgentSupervisor
- Real `createAgentExecutor()` path
- Explicit knowledge backend config via factory (`backend: "memory"` for the local harness)
- Knowledge extraction write-back
- Scoped retrieval (`tenant`, `workflowType`, `queue`)
- Fake Claude CLI shim so the executor path is exercised without depending on a real external coding agent
- Temporary git repo so file changes / git diff / changed-files capture are exercised

## Why this environment
This gives us a realistic local harness that exercises the seams we actually changed:
- adapter -> router -> executor -> managed agent -> extraction -> knowledge store
- retrieval before execution
- scoped recall and non-leakage
- post-run write-back with derived scope

## Test scenarios

### 1. Webhook ingress to completed task
Submit a webhook task over HTTP and verify the task reaches `completed`.

### 2. Same-tenant scoped recall reaches the worker
Seed prior knowledge for tenant `acme` + workflow `password-reset`, submit a matching task, and verify the fake worker receives the prior knowledge in its prompt.

### 3. Cross-tenant memory does not leak
Seed similar knowledge for `globex`, submit an `acme` task, and verify the worker prompt does not include the `globex` guidance.

### 4. Post-run extraction writes knowledge back with scope
Run a successful scoped task and verify extracted knowledge is stored with the derived task scope.

### 5. Write-back compounds into next run
Submit a second matching task and verify it can recall the newly written scoped knowledge from the first run.

### 6. Changed files / git diff path is exercised
Use a temporary git repo and confirm the fake worker modifies tracked content so the executor captures changed files for extraction context.

## Out of scope for this pass
- Real Chroma persistence smoke, because no local Chroma service is currently running
- Postgres-backed store, which is future work
- Structured run-record case memory (Issue 3)

## Acceptance criteria
- The local harness proves ingress, routing, execution, scoped retrieval, non-leakage, and scoped write-back in one test flow
- The test is runnable as part of the repo test suite
- Failures clearly point to a broken seam rather than a vague end-to-end blob

## Execution
1. Add a focused E2E test file for the memory-context harness
2. Wire it into the repo test scripts
3. Run the focused test
4. Run the full test suite to ensure it integrates cleanly
