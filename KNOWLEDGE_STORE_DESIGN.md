# Knowledge Store Design - Issue 1

## Purpose
Define the first durable knowledge-store implementation step for TierZero without losing sight of the real target architecture.

## Product constraint
TierZero's moat is not generic RAG.
It is durable customer-specific operating context attached to a bounded queue-native worker.

That means the knowledge store must support:
- persistence across restarts
- safe scoping later
- usage tracking
- supersession
- integration with orchestrator execution

## Current repo reality
Today orchestrator mode does this in `src/cli.ts`:
- if `config.knowledge.enabled !== false`
- instantiate `InMemoryKnowledgeStore`

So the runtime forgets everything on restart.

The repo also already contains `ChromaKnowledgeStore`, but it is not wired in as the orchestrator runtime backend and it has weak metadata-update behavior for `recordUsage` and `supersede`.

## Recommended architecture
### Target architecture
Use Postgres as the durable source of truth.

Recommended shape:
- `knowledge_entries` table for canonical metadata + content
- `knowledge_embeddings` table or embedded vector column later
- optional `pgvector` when semantic retrieval is ready for real production use

Why Postgres:
- durable and operationally boring
- better metadata updates than Chroma for usage/supersession/freshness
- fits later tenant scoping and structured case memory cleanly
- supports relational edge tables for the future context graph

### Immediate implementation stance
Do not try to land the whole final Postgres system in one leap if it muddies the repo.

The clean first step is:
1. introduce an explicit knowledge-store backend factory
2. make orchestrator backend selection configurable
3. stop hardcoding in-memory for runtime
4. wire an existing durable backend path now
5. leave room for a Postgres backend to replace or sit beside the interim backend cleanly

That gives us real forward motion without pretending the first code pass finished the whole moat.

## Backend model
Proposed config shape:

```json
{
  "knowledge": {
    "enabled": true,
    "backend": "memory | chroma | postgres",
    "chroma": {
      "collectionName": "tierzero-knowledge",
      "chromaUrl": "http://localhost:8000"
    },
    "postgres": {
      "connectionString": "postgres://...",
      "schema": "public"
    }
  }
}
```

## Suggested runtime rules
- default backend for tests/dev can still be `memory`
- orchestrator production path should use an explicit durable backend
- if durable backend is configured incorrectly, fail loudly instead of silently downgrading to memory

## Schema direction for the future Postgres backend
### knowledge_entries
Suggested columns:
- `id uuid primary key`
- `type text not null`
- `title text not null`
- `content text not null`
- `task_id text not null`
- `agent_name text not null`
- `source_timestamp timestamptz not null`
- `tags jsonb not null`
- `related_files jsonb not null`
- `confidence double precision not null`
- `usage_count integer not null default 0`
- `last_used_at timestamptz null`
- `superseded_by uuid null`
- `created_at timestamptz not null default now()`

Future scope columns for Issue 2:
- `tenant_id text null`
- `queue text null`
- `workflow_type text null`
- `environment text null`

## Design decisions
### 1. Backend factory before backend sprawl
We want one place that decides which `KnowledgeStore` implementation runs.
That avoids more ad hoc `if memory else ...` logic in `cli.ts`.

### 2. Durable backend selection must be explicit
Silent fallback to memory is cute in development and dangerous in production.

### 3. Postgres remains the north star
Using an interim durable backend now is acceptable.
Pretending it replaces the need for a proper relational source of truth is not.

## Definition of done for this design slice
- the repo has a clean backend-selection seam
- orchestrator runtime can use a durable store path
- config typing/validation understands knowledge backend settings
- docs make the next Postgres step obvious

## Follow-on after this design slice
1. implement Postgres-backed `KnowledgeStore`
2. add tenant/workflow scope fields
3. add structured ticket run records
4. then build graph relationships and hybrid retrieval
