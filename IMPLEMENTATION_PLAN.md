# TierZero Implementation Plan

## Objective
Turn TierZero into a money machine by selling a narrow, high-value wedge first, then widening from there.

## Chosen wedge
**Overnight Service Desk Queue Clearance**

TierZero is positioned first as an autonomous Tier 0 / Tier 1 service desk worker for teams using ServiceNow or similar ticket systems.

## Why this wedge
- The current product already matches ticket-driven automation better than any other revenue lane in the workspace.
- Buyers already understand queue pain, SLA pain, backlog pain, and headcount cost.
- The pitch is outcome-based, not tool-based.
- It gives a clean path from pilot -> expansion -> platform.

## Offer statement
"TierZero clears repetitive service desk work overnight so your human team starts the day with a smaller queue, faster SLA response, and fewer low-value tickets."

## ICP
- First buyers should be reachable design-partner style accounts, not giant enterprise logos
- Best fit: regional MSPs, outsourced help desks, and 100-1000 employee multi-site operators with lean IT teams
- Teams with backlog, after-hours queue growth, or repetitive ticket classes
- Environments where audit trail and approval boundaries matter, but procurement drag is still low enough to close a pilot

## Initial job to win
Handle one narrow ticket class end-to-end:
- password reset / access unlock
- software access request triage
- routine fulfillment / provisioning requests
- known runbook-backed incidents

Do **not** start with a giant horizontal promise.
Start with one painful category the buyer already wishes they could remove from the queue.

## Pricing direction
Pilot first, not enterprise-year-one fantasy pricing.

### Pilot
- For early design partners: setup fee $3k-$10k
- Monthly pilot: $2k-$6k
- 14-30 day scoped engagement to earn proof quickly
- Raise pricing after real proof and repeatability exist

### Expansion
- Price against labor replaced and queue reduction, not seats
- Target: low five figures MRR per account once multiple workflows are live

## Proof required
Before broader GTM, prove these in one deployment:
1. Tickets can be ingested reliably
2. A narrow workflow can be completed end-to-end
3. Audit trail is buyer-safe
4. Human escalation works cleanly
5. Measurable queue reduction exists

## Current loop state
### Completed in this iteration
- Picked the primary money lane
- Chose a concrete initial market and offer
- Wrote the first one-pager
- Drafted the first outbound message set
- Drafted the first ROI calculator
- Wrote the buyer-facing architecture diagram
- Chose and defined the first demo workflow
- Wrote the buyer-facing pilot demo walkthrough
- Wrote the buyer-facing pilot metrics dashboard spec
- Added Ralph loop state files so the repo can resume cold
- Wrote the target account list and outbound execution pack
- Wrote the buyer-ready pilot package that combines scope, trust story, metrics, ROI framing, and pilot close
- Wrote the first source-backed 40-account target slate for the overnight service desk wedge
- Revalidated and tightened the 40-account slate so every account now carries explicit industry/archetype, fit notes, buyer roles, and score fields
- Re-cut the target strategy around realistic first buyers instead of prestige-logo enterprise fantasies
- Wrote `go-to-market/REALISTIC_BEACHHEAD.md` to lock the commercial constraints
- Built `go-to-market/REALISTIC_FIRST_WAVE_TARGETS.md` with a ranked shortlist biased toward MSPs, outsourced help desks, and lower-friction multi-site operators
- Wrote `MEMORY_CONTEXT_GITHUB_ISSUES.md` with GitHub-ready drafts for Issues 1-3 of the memory/context buildout
- Wrote `KNOWLEDGE_STORE_DESIGN.md` to lock the design direction for Issue 1 and keep Postgres as the north-star architecture
- Started Issue 1 code by introducing a knowledge-store factory, explicit knowledge backend config validation, and orchestrator wiring for configurable memory vs Chroma backends
- Finished the first usable Issue 1 pass: orchestrator config now carries explicit knowledge settings, managed execution receives retrieved prior knowledge, knowledge extraction is instantiated when configured credentials exist, and executor runtime captures changed files/git diff for write-back
- Landed Issue 2 scoped retrieval: knowledge entries now carry tenant/workflow/queue scope, in-memory and Chroma retrieval filter out incompatible scope, scoped matches outrank global entries, and orchestrator derives scope from task metadata/payload for both retrieval and write-back

### Next top task
Start Issue 3 for the memory/context moat:
- define and persist structured run records for every handled task
- record success, failure, and escalation outcomes instead of relying on loose summaries
- capture retrieved context ids, actions taken, workflow, and scope fields
- make the run-record path queryable enough to support later similar-case recall

## Anti-goals
- Do not chase tiny side products for revenue right now
- Do not pitch "general AI automation"
- Do not broaden into every vertical before one wedge closes
- Do not optimize the watcher forever without a sellable package
