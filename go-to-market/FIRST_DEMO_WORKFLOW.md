# TierZero - First Demo Workflow

## Chosen first workflow
**Password reset / account unlock for standard employee accounts**

This is the first workflow to demo and the first workflow to pilot.

## Why this one
- Extremely easy for buyers to understand
- Repetitive and annoying enough to matter
- Often appears outside business hours
- Clear success / failure state
- Easy to prove auditability
- Narrow enough to keep the pilot safe

This is not the forever workflow.
It is the wedge that proves the model.

---

## Exact demo scope
TierZero handles a ServiceNow ticket when all of the following are true:
- ticket type is password reset or account unlock
- requester is a standard employee account
- required identity verification / policy checks are already satisfied upstream
- target system is in the approved system list
- the account is not privileged
- required fields are present and valid

If any of those are false, TierZero escalates.

---

## Happy path
1. New password reset / unlock ticket lands in the scoped ServiceNow queue
2. TierZero reads ticket fields, comments, and required metadata
3. TierZero checks runbook and automation rules
4. TierZero confirms the ticket is in approved scope
5. TierZero triggers the approved reset / unlock action
6. TierZero updates the ticket with:
   - action taken
   - timestamp
   - system touched
   - result
   - next step for the user if relevant
7. Ticket is resolved or moved to the correct terminal state

---

## Escalation path
TierZero escalates instead of acting when:
- user is privileged or high-risk
- required verification is missing
- request is ambiguous
- downstream system call fails
- ticket data is incomplete
- policy says a human must approve

Escalation output should include:
- why it stopped
- what condition failed
- what human needs to do next

---

## Demo script

### Show 1: in-scope ticket
- ingest ticket
- show rule match
- execute approved action
- write audit trail
- resolve

### Show 2: out-of-scope ticket
- ingest ticket
- detect missing or risky condition
- escalate cleanly
- show that TierZero stops instead of bluffing

The second demo matters almost as much as the first.
Buyers need to see restraint, not just action.

---

## Required systems for demo credibility
- ServiceNow or realistic simulated ServiceNow ticket flow
- mock or real approved action endpoint for account unlock / reset
- audit note written back into the ticket
- dashboard or simple before/after metrics view

---

## Metrics to track in pilot
- number of eligible tickets
- automation rate
- escalation rate
- average completion time
- backlog reduction by morning
- human hours avoided
- failure / rollback count

---

## What is explicitly out of scope for demo one
- privileged accounts
- MFA resets
- access changes beyond reset / unlock
- multi-system identity orchestration
- exception-heavy bespoke cases
- anything requiring hidden magic or manual babysitting

---

## Sales angle for this workflow
Do not sell this as "we automate password resets."
That sounds tiny.

Sell it as:
**the first safe proof point that TierZero can own repetitive queue work overnight, visibly and reliably.**

Once that works, the expansion path is obvious:
- access request triage
- software fulfillment requests
- runbook-backed incidents
- standard onboarding / offboarding subflows

---

## Expansion rule
Only expand after this workflow proves:
1. technical reliability
2. safe escalation
3. measurable queue improvement
4. buyer trust in the audit trail
