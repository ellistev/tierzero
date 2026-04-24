# TierZero Pilot Demo Walkthrough

## Demo outcome
Show that TierZero can safely own one repetitive overnight service desk workflow, leave a clean audit trail, and shrink the morning queue.

This demo is not trying to prove that TierZero can do everything.
It is trying to prove that TierZero can be trusted with one narrow, painful class of work and then expand.

## Audience
Best audience for this demo:
- Head of Service Desk
- IT Operations leader
- ServiceNow owner
- CIO / Director who cares about backlog, SLA pressure, and labor leverage

## Opening line
"This is the first safe wedge for TierZero. We are not asking you to trust a general AI agent with your whole queue. We are showing one workflow your team handles over and over, and how TierZero can own it overnight with a full audit trail and clean escalation when something falls out of scope."

## The promise to keep repeating
**Start each morning with a smaller queue.**

## Demo setup
Before the call, have these ready:
- a realistic ServiceNow ticket view or simulated equivalent
- one in-scope password reset / unlock ticket
- one out-of-scope or high-risk ticket
- the approved workflow / runbook TierZero uses
- the action endpoint or mocked system showing the reset / unlock step
- the resulting ticket update / audit note
- one simple before / after metrics view for handled volume and completion time

## What the buyer should see in 10 minutes
1. A repetitive ticket lands
2. TierZero reads the ticket and runbook context
3. TierZero decides whether the request is in scope
4. TierZero either acts or escalates
5. Every path leaves an auditable record
6. The result ties back to queue reduction, not chatbot novelty

## Live flow

### 1. Frame the pain - 60 seconds
Say:
- "Most service desk teams do not need more dashboards. They need fewer repetitive tickets sitting there in the morning."
- "We start with one narrow workflow so safety and ROI are both visible."
- "For this pilot, that workflow is password reset and account unlock for standard employee accounts."

### 2. Show the in-scope ticket - 2 minutes
Open the in-scope ticket.
Narrate:
- ticket type is clearly password reset or unlock
- requester is a standard employee account
- required fields are present
- policy checks were satisfied upstream
- no privilege or exception flags are present

Point to the key message:
**TierZero is not guessing. It is checking scope before it touches anything.**

### 3. Show the decision and action - 2 minutes
Walk through:
- TierZero reads the ticket and supporting runbook
- TierZero confirms the request fits the approved workflow
- TierZero triggers the approved reset / unlock action
- TierZero writes back the result, timestamp, system touched, and user-facing next step

Narrate:
- "This is not hidden automation in the shadows. The ticket is the record."
- "If your team reviews this later, they can see exactly what happened."

### 4. Show the audit trail - 1 minute
Highlight the ticket update or activity record.
Make sure it shows:
- action taken
- time performed
- target system
- result status
- what the end user should do next

Say:
- "The audit trail matters as much as the automation. If this saves time but creates operational anxiety, it is useless."

### 5. Show the out-of-scope ticket - 2 minutes
Open the risky or incomplete ticket.
Examples:
- privileged account
- missing verification
- ambiguous request
- unsupported target system

Walk through:
- TierZero reads the ticket
- detects the condition that breaks policy
- stops
- escalates with a clear reason and next step for the human

Say:
- "This is the trust moment. The product is valuable because it knows when to stop."
- "A bad agent tries to bluff through ambiguity. TierZero escalates cleanly."

### 6. Tie it to business value - 90 seconds
Show a simple before / after summary:
- eligible overnight tickets
- automated tickets
- escalated tickets
- average completion time
- morning backlog reduction

Say:
- "We do not need to sell fantasy ROI on day one."
- "The first win is proving safe queue ownership in one repetitive class of work."
- "Once that trust exists, you expand into adjacent workflows instead of restarting the conversation from zero."

## Talk track if they ask why start so narrow
Say:
- "Because that is how you earn operational trust."
- "We start with a ticket class your team already hates handling, prove safety and auditability, and then widen only after the first workflow works."
- "The pilot is not the end state. It is the proof point."

## Common objections and answers

### "Password resets sound too small"
Answer:
- "Correct. On their own, they are a wedge, not the whole business case."
- "What matters is that they are repetitive, easy to audit, and prove the overnight queue-clearance model."
- "After that, the expansion path is obvious: access request triage, software fulfillment, and runbook-backed incidents."

### "How do we know it will not do something stupid?"
Answer:
- "The demo intentionally shows both action and restraint."
- "Scope checks, policy boundaries, and escalation are part of the product, not afterthoughts."
- "If the ticket is missing data or touches a privileged case, TierZero stops and hands it back cleanly."

### "What makes this different from AI copilot fluff?"
Answer:
- "Copilot helps a human go faster. TierZero owns a narrow workflow outright."
- "The metric is not clicks saved. The metric is fewer repetitive tickets sitting in the queue by morning."

### "How would a pilot work?"
Answer:
- "One queue, one workflow, one environment, 30 to 45 days."
- "We measure handled volume, completion speed, escalation quality, and backlog impact."
- "If the proof is there, we expand. If not, we stop without pretending it is broader than it is."

## Demo success criteria
The demo worked if the buyer leaves believing:
- TierZero can safely automate one real workflow today
- the audit trail is strong enough for operational review
- escalation is a feature, not a failure
- the pilot scope is controlled and believable
- expansion after proof feels natural

## Close into the pilot
Use a direct close:

"Pick one repetitive workflow your team wants gone from the morning queue. We will scope a 30 to 45 day pilot around it, prove safe execution and measurable backlog reduction, and then decide whether it deserves expansion."

## What the next asset should cover
The next loop should build the pilot metrics dashboard spec so the business outcome is visible before the first real customer call.
