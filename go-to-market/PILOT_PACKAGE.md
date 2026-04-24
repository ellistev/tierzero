# TierZero Pilot Package

## What this packet is
This is the buyer-ready overview for the first **TierZero** pilot.

The goal is simple:
**prove that TierZero can safely remove one repetitive class of overnight service desk work from the morning queue.**

This is not a broad AI transformation proposal.
It is a narrow, measurable pilot designed to answer one commercial question fast:
**Should this workflow be handed to TierZero, and is the result strong enough to expand?**

## Big promise
**Start each morning with a smaller queue.**

TierZero handles repetitive service desk work overnight so your human team can focus on exceptions, escalations, and real problems instead of grinding through routine tickets.

## Why start with this wedge
The first pilot focuses on:
**password reset / account unlock for standard employee accounts**

Why this is the right first workflow:
- buyers instantly understand the pain
- the workflow is repetitive enough to matter
- it is measurable
- it is easy to audit
- it creates a safe proof point for broader queue ownership later

The point is not that password resets are the whole business.
The point is that they are the cleanest first proof that TierZero can own repetitive service desk work without turning the queue into chaos.

## What the pilot is meant to prove
A good pilot resolves real buying uncertainty.
For TierZero, the first pilot should prove five things in the buyer's environment:
1. TierZero can reliably ingest the right tickets
2. It can complete one approved workflow end-to-end
3. It leaves an audit trail strong enough for operational review
4. It escalates exceptions cleanly instead of bluffing through them
5. It produces visible queue and SLA improvement worth expanding

If the pilot does not answer those five questions, it is the wrong pilot.

## Pilot scope
### Workflow in scope
- password reset / account unlock
- standard employee accounts only
- approved systems only
- one queue
- one environment
- one buyer-approved policy boundary

### Explicitly out of scope
- privileged accounts
- MFA resets
- exception-heavy identity work
- bespoke approvals
- multi-system orchestration beyond the agreed workflow
- any workflow the buyer has not explicitly approved for the pilot

That narrow scope is a feature, not a limitation.
It is how the pilot stays safe, believable, and measurable.

## What TierZero does in the pilot
For in-scope tickets, TierZero can:
- read the incoming ticket and relevant runbook context
- determine whether the request is in scope
- execute the approved reset or unlock action
- update the ticket with the audit trail
- resolve or route the ticket appropriately

For out-of-scope or risky tickets, TierZero will:
- stop
- state the reason
- hand off with a clear next step for the human owner

## What the buyer will see
The pilot is designed to show both action and restraint.

### In-scope path
The buyer sees:
- a ticket arrives
- TierZero checks scope and policy conditions
- TierZero completes the approved action
- the ticket gets a clean, reviewable audit record

### Out-of-scope path
The buyer also sees:
- TierZero detects the condition that breaks policy or scope
- TierZero does not force bad automation
- the ticket is escalated with a clear reason and next step

That second path matters almost as much as the first.
A trustworthy automation system is defined by how it stops, not just by how it acts.

## Pilot structure
### Duration
30-45 days

### Pilot phases
#### Phase 1 - Scope and setup
- confirm the queue, workflow, and approved systems
- confirm in-scope vs out-of-scope rules
- confirm the baseline period and morning checkpoint time
- align on stakeholders, review rhythm, and success criteria

#### Phase 2 - Live pilot execution
- run the approved workflow in the selected environment
- measure performance against the agreed baseline
- monitor escalations, failures, and audit coverage
- review exceptions and tighten the workflow if needed

#### Phase 3 - Pilot review and go / no-go decision
- compare pilot results to baseline
- review queue impact, speed, and trust metrics
- decide whether to expand into adjacent workflows

## Who should be involved on the buyer side
### Operational owner
Usually:
- Head of Service Desk
- Director of End User Support
- IT Support Manager

### Executive sponsor
Usually:
- CIO
- VP of IT
- VP or Director of IT Operations

### Technical and risk reviewers
Usually:
- ServiceNow owner
- IAM or identity lead
- compliance or security stakeholder when relevant

The operational owner feels the pain.
The sponsor funds the pilot.
The technical reviewers make sure the workflow stays inside reality.

## What success looks like
The pilot should be measured against the same three business outcomes throughout:
- **queue reduction**
- **speed**
- **trust**

### Core pilot metrics
The buyer-facing scoreboard should show:
- eligible tickets
- automated completions
- automation rate
- clean escalations
- escalation quality rate
- average completion time
- queue hours removed
- morning backlog reduction
- SLA-risk reduction
- failure / rollback count

### What matters most
The first number the buyer should care about is:
**morning backlog reduction for the in-scope workflow**

That is the clearest proof that TierZero is taking real work off the queue.

## How ROI should be framed
Be honest about the economics.

The first workflow alone may not fully justify the pilot on labor savings alone.
That is normal.

The pilot should be sold on:
- reduced morning backlog
- faster response and completion times
- safe proof of autonomous queue ownership
- visible auditability
- expansion value into adjacent workflows

The right buyer understands that the first workflow is the wedge, not the whole expansion case.

## Commercial shape
### Pilot pricing
- setup fee: **$15k-$35k**
- monthly pilot: **$5k-$12k**
- duration: **30-45 days**

### Why the pricing is structured this way
The buyer is not paying for a generic proof-of-concept theater project.
They are paying to prove one real workflow in their environment with real controls, real metrics, and a clean expansion decision at the end.

## What the buyer needs to provide
To keep the pilot clean and fast, the buyer should provide:
- the target queue
- the approved first workflow
- required runbook or policy context
- access to the ticket data needed for the pilot
- the list of approved target systems for reset / unlock
- named pilot stakeholders
- agreement on baseline and success metrics

## What TierZero delivers
- a scoped workflow that operates inside approved rules
- a demoable trust story showing both action and escalation
- a buyer-facing metrics view tied to queue reduction, speed, and trust
- auditability on each automated action or escalation
- a clear end-of-pilot expansion recommendation

## Why this is different from AI copilot fluff
TierZero is not positioned as a helper that makes analysts click faster.
It is positioned as an **AI employee for one narrow queue workflow**.

That difference matters.
The metric is not "assistant adoption."
The metric is whether fewer repetitive tickets are sitting in the queue by morning.

## Likely objections and the answer
### "Password resets sound too small"
Correct.
They are a wedge.
What matters is that they are repetitive, measurable, and safe to audit.
If the pilot proves queue ownership here, the path into adjacent workflows is obvious.

### "How do we know it will not do something stupid?"
The pilot is intentionally structured to prove both safe action and safe escalation.
If a request is out of scope, missing required conditions, or policy-sensitive, TierZero stops and hands it off cleanly.

### "Why not start with a broader workflow?"
Because broad first pilots are how people create fake progress and real risk.
Narrow pilots create credible proof.

## Expansion path after a successful pilot
If the first workflow works, the most natural next expansions are:
- access request triage
- software fulfillment requests
- known runbook-backed incidents
- standard onboarding or offboarding subflows

The goal is not to keep selling one tiny automation forever.
The goal is to establish trusted queue ownership, then widen from there.

## Recommended next step
Use this close:

**"If this workflow is painful enough and measurable enough to matter, the next step is a short pilot-scoping conversation. We pick one queue, one workflow, one environment, align on success criteria, and decide whether TierZero should own that slice of work overnight."**

## Internal note on how to use this packet
Send this after a prospect gives a positive first signal.
Do not lead with the whole packet cold.
Lead with the pain, then use this to turn interest into a scoped pilot conversation.
