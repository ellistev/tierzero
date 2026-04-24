# TierZero Memory + Context - GitHub Issue Drafts

These are the first three GitHub-ready issues for the memory/context moat buildout.

---

## Issue 1 - Persistent KnowledgeStore for orchestrator

### Title
Persistent KnowledgeStore for orchestrator

### Why
Right now orchestrator mode boots with `InMemoryKnowledgeStore`, which means TierZero forgets everything on restart. That kills the compounding-memory story before it starts.

### Problem
`src/cli.ts` currently initializes an in-memory store in orchestrator mode. We already have `KnowledgeStore` as an interface, but the default runtime path does not persist entries across process restarts.

### Goal
Replace the current runtime default with a durable `KnowledgeStore` path and make the backend explicitly configurable.

### Scope
- add a configurable knowledge-store factory for orchestrator startup
- support at least one durable backend path in orchestrator mode
- keep parity with the current `KnowledgeStore` contract:
  - `add`
  - `search`
  - `findByTags`
  - `findByFiles`
  - `get`
  - `recordUsage`
  - `supersede`
  - `stats`
- update orchestrator config typing/validation for `knowledge` settings
- stop silently defaulting to in-memory when knowledge is enabled in orchestrator mode unless explicitly configured that way for testing/dev

### Non-goals
- tenant/workflow scoping
- structured ticket case memory
- context graph relationships
- retrieval fusion

### Definition of done
- knowledge survives process restarts in orchestrator mode
- backend selection is explicit and validated
- orchestration path no longer hardcodes `InMemoryKnowledgeStore`
- tests cover backend selection and persistence path behavior
- docs/example config show how to enable durable knowledge

### Files likely involved
- `src/cli.ts`
- `src/cli/config-validator.ts`
- `src/knowledge/store.ts`
- `src/knowledge/*`
- `orchestrator.json`

### Validation
- `npm run typecheck`
- targeted knowledge/orchestrator tests
- full `npm test`

---

## Issue 2 - Tenant-scoped and workflow-scoped knowledge retrieval

### Title
Tenant-scoped and workflow-scoped knowledge retrieval

### Why
Durable memory without scope becomes dangerous soup. TierZero must not recall the wrong customer's operating context or drown workflow-specific lessons in generic noise.

### Problem
Current `KnowledgeEntry` shape and retrieval path are too generic. Retrieval is driven mostly by free-text similarity and confidence, with no strong customer/workflow scoping.

### Goal
Extend the knowledge model and retrieval flow so queries can prefer or require tenant/customer and workflow scope.

### Scope
- extend knowledge metadata to support:
  - tenant/customer scope
  - queue scope
  - normalized workflow type
  - optional environment/system scope where useful
- add scoped search filters to the retrieval contract
- pass scope from orchestrator/runtime into retrieval when known
- prefer scoped matches over global matches
- ensure unknown scope degrades safely instead of leaking cross-tenant context

### Non-goals
- context graph tables
- contradiction handling
- post-run structured case memory model

### Definition of done
- search path can filter by tenant/customer
- search path can filter by workflow type
- retrieval ranking prefers scoped hits over generic hits
- tests prove customer A entries are not returned for customer B when scoped data exists
- orchestrator path actually passes scope when available

### Files likely involved
- `src/knowledge/store.ts`
- `src/knowledge/*`
- `src/orchestrator/agent-executor.ts`
- `src/workflows/*`

### Validation
- `npm run typecheck`
- targeted retrieval tests
- full `npm test`

---

## Issue 3 - Structured ticket run record model + persistence

### Title
Structured ticket run record model + persistence

### Why
TierZero needs episodic memory, not just reusable snippets. Every handled ticket should leave behind a replayable case record.

### Problem
Today the system mostly has loose summaries, audit notes, and best-effort extracted knowledge. That is not the same thing as structured case memory.

### Goal
Persist one structured run record per handled ticket/task so TierZero can learn from prior cases and recover operating context cleanly.

### Suggested record shape
- tenant/customer
- queue
- ticket/task id
- normalized workflow type
- requester type
- systems touched
- runbooks considered
- retrieved context ids
- decision made
- action attempted
- escalation reason
- final outcome
- audit note written back
- started/completed timestamps

### Scope
- define the run-record model
- persist a record for completed runs
- persist failure and escalation outcomes too, not just success
- make records queryable by workflow, system, outcome, and escalation path
- keep this separate from reusable semantic knowledge entries

### Non-goals
- graph relationships
- hybrid retrieval composer
- freshness/supersession dashboards

### Definition of done
- each handled ticket/task emits a structured run record
- records can be queried programmatically for similar-case recall
- failures/escalations are included
- tests cover record creation for success, escalation, and failure paths

### Files likely involved
- `src/orchestrator/*`
- `src/agent/*`
- `src/read-models/*`
- `src/domain/*`
- `src/knowledge/*`

### Validation
- `npm run typecheck`
- targeted orchestrator/domain tests
- full `npm test`
