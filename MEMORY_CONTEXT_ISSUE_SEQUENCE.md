# TierZero Memory + Context Issue Sequence

## Purpose
Turn the memory/context roadmap into a build order that compounds without dragging the repo into graph-theory cosplay.

Core framing stays fixed:
- TierZero is a bounded queue-native worker
- the model is replaceable
- the harness plus durable customer-specific context is the moat
- first proof stays narrow: password reset / account unlock for standard employee accounts

## Recommended execution order

### Issue 1 - Persistent KnowledgeStore for orchestrator
**Goal**
Replace the current `InMemoryKnowledgeStore` in orchestrator mode with a durable implementation.

**Why first**
Right now the system forgets everything on restart. Nothing compounds until this is fixed.

**Scope**
- add a persistent `KnowledgeStore` implementation
- support basic add/get/search/findByTags/findByFiles/recordUsage/supersede/stats parity with the interface in `src/knowledge/store.ts`
- wire it into `src/cli.ts` orchestrator startup instead of defaulting to in-memory only
- make storage backend configurable

**Practical recommendation**
Start with Postgres. Keep embeddings optional at first if needed, but the store itself must persist.

**Definition of done**
- knowledge survives process restarts
- orchestrator can boot against persistent storage
- existing interface contract still passes
- stats and supersession still work

**Depends on**
- none

---

### Issue 2 - Tenant-scoped and workflow-scoped retrieval
**Goal**
Stop treating all knowledge as global soup.

**Why second**
Durability without scope will create noisy recall and dangerous cross-customer leakage.

**Scope**
- extend knowledge metadata to support tenant/customer scope
- add workflow type / queue scope fields
- add search filters for tenant + workflow
- down-rank or exclude generic entries when scoped matches exist

**Definition of done**
- retrieval can filter by tenant
- retrieval can filter by workflow type
- orchestrator query path passes those filters where available
- tests prove one customer does not leak into another customer's context

**Depends on**
- Issue 1

---

### Issue 3 - Structured ticket run record model
**Goal**
Create episodic memory for every handled task/ticket run.

**Why here**
This is the replayable case memory layer. It gives TierZero a case history, not just loose snippets.

**Suggested record shape**
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
- timestamps

**Definition of done**
- every completed run emits a structured case record
- records are queryable by workflow, system, outcome, and escalation path
- failures and escalations are recorded too, not just happy paths

**Depends on**
- Issue 1

---

### Issue 4 - Stronger post-task extraction from real evidence
**Goal**
Upgrade extraction so it learns from actual work evidence, not thin summaries.

**Current gap**
`src/orchestrator/agent-executor.ts` extracts from limited output and blank `gitDiff`, so the learning payload is weak.

**Scope**
- capture richer execution evidence
- pass structured evidence into the extractor
- extract reusable lessons, entities, touched systems, error signatures, policies, and outcomes
- distinguish reusable semantic knowledge from one-off case facts

**Definition of done**
- extraction uses more than the last chunk of agent output
- extracted entries can include policy/error/workflow/system signals
- evidence quality materially improves over current thin post-run extraction

**Depends on**
- Issue 1
- Issue 3

---

### Issue 5 - Managed-agent context injection actually reaches the worker
**Goal**
Make retrieved knowledge materially influence managed execution, not just get fetched and then lost in the handoff.

**Current gap**
The orchestrator path searches prior knowledge, but the managed execution path does not strongly guarantee that context is injected into the actual worker prompt/task package.

**Scope**
- trace the retrieval payload from orchestrator into managed worker startup
- inject prior cases + reusable lessons into the worker's execution context
- make the injection structured, bounded, and visible in logs/audit

**Definition of done**
- retrieved context is present in the worker input every time retrieval succeeds
- worker input clearly separates prior cases vs reusable lessons
- audit/logging shows what context was injected

**Depends on**
- Issue 2
- Issue 3
- Issue 4

---

### Issue 6 - Context graph tables with relational edges
**Goal**
Add lightweight graph structure without dragging the project into Neo4j too early.

**Entity types**
- customer
- queue
- workflow
- system
- application
- error_signature
- runbook
- policy
- team
- action_type

**Edge types**
- `TICKET_MATCHED_WORKFLOW`
- `WORKFLOW_TOUCHES_SYSTEM`
- `RUNBOOK_SUPPORTS_WORKFLOW`
- `POLICY_BLOCKS_ACTION`
- `ERROR_ESCALATES_TO_TEAM`
- `ACTION_RESOLVED_ERROR`
- `CUSTOMER_ALLOWS_ACTION`

**Definition of done**
- entity and edge tables exist
- completed runs can upsert entities and edges
- graph neighbors can be queried cheaply for a workflow/system/error tuple

**Depends on**
- Issue 3
- Issue 4

---

### Issue 7 - Hybrid retrieval composer
**Goal**
Fuse three memory layers into one decision-ready context block:
- prior similar cases
- reusable semantic knowledge
- graph-derived operational relationships

**Why now**
This is where the memory system starts to feel like a moat instead of a storage project.

**Scope**
- build a retrieval composer stage before decision/execution
- merge and rank case memory, semantic memory, and graph neighbors
- enforce tenant and workflow scoping
- keep the final context block bounded and structured

**Definition of done**
- decision stage receives a composed context block
- output shows which prior cases, lessons, and graph signals were used
- retrieval quality is measurably better than semantic search alone

**Depends on**
- Issue 2
- Issue 5
- Issue 6

---

### Issue 8 - Freshness, supersession, contradiction, and observability
**Goal**
Stop bad memory from calcifying.

**Scope**
- support freshness timestamps and confirmation windows
- support superseded knowledge explicitly
- flag contradictions between old lessons and newer evidence
- add observability for hits, misses, stale recalls, and ignored recalls

**Definition of done**
- stale knowledge can be down-ranked
- contradictory entries can be surfaced for review
- dashboard/log output shows memory hit rate and stale-hit rate
- memory system is inspectable enough to trust in a buyer demo

**Depends on**
- Issue 7

## What should wait
These can wait until the above exists:
- Neo4j
- GraphRAG marketing fluff
- broad multi-workflow expansion
- agentic self-editing memory with weak auditability
- fancy UI over memory before the retrieval loop is actually good

## Best immediate next move
Start with Issues 1-3 as a tight first tranche:
1. persistent store
2. scoped retrieval
3. structured run records

That gets TierZero from "interesting scaffolding" to "it can actually remember the right things after a restart."

## Suggested milestone packaging

### Milestone A - Durable memory base
- Issue 1
- Issue 2
- Issue 3

### Milestone B - Better learning loop
- Issue 4
- Issue 5

### Milestone C - Operating context moat
- Issue 6
- Issue 7
- Issue 8
