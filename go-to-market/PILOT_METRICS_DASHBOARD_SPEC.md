# TierZero Pilot Metrics Dashboard Spec

## Purpose
This dashboard is the buyer-facing scoreboard for the first TierZero pilot.

It should answer one question fast:
**Did TierZero safely remove real password reset / account unlock work from the morning queue?**

This is not a product analytics dashboard.
It is an operations and business-outcome dashboard for the pilot buyer.

## Workflow in scope
**Password reset / account unlock for standard employee accounts**

Only tickets that meet the approved workflow rules count toward pilot performance.
Anything out of scope should be shown as a clean escalation, not hidden.

## Audience
Primary viewers:
- Head of Service Desk
- IT Operations leader
- ServiceNow owner
- CIO or director sponsoring the pilot

## Dashboard promise
The dashboard must prove five things:
1. TierZero is taking repetitive work out of the queue
2. It is completing eligible tickets faster than the current process
3. It knows when to escalate instead of forcing bad automation
4. Its actions are auditable and low-drama to review
5. The pilot is worth expanding into adjacent workflows

## Time views
The dashboard should support three views only:
- **Baseline** - the prior 2 to 4 weeks before TierZero is turned on
- **Pilot to date** - cumulative performance since pilot start
- **Daily / weekly trend** - enough to show consistency, not vanity noise

Baseline should come from the same queue and same workflow class where possible.
If historical automation data does not exist, baseline should still show ticket volume, handling time, backlog, and SLA risk from the human-only process.

## North-star pilot outcome
**Morning backlog reduction for the in-scope workflow**

Primary headline metric:
- **Morning queue reduction** = baseline morning in-scope backlog minus current morning in-scope backlog

This is the first number the buyer should see.

## Exact pilot metrics

### 1. Eligible tickets
Definition:
- Tickets in the scoped queue that match the approved password reset / unlock workflow rules

Why it matters:
- Shows the real opportunity size for the wedge
- Prevents inflated claims from counting unrelated tickets

Formula:
- count of tickets marked in-scope during the selected period

### 2. Automated completions
Definition:
- Eligible tickets completed end-to-end by TierZero without human intervention

Why it matters:
- Shows real work removed from the queue

Formula:
- count of in-scope tickets with successful autonomous completion

### 3. Automation rate
Definition:
- Share of eligible tickets completed autonomously

Why it matters:
- Shows how much of the repetitive workflow TierZero can safely own

Formula:
- automated completions / eligible tickets

### 4. Clean escalations
Definition:
- Eligible or near-eligible tickets that TierZero intentionally routed to a human with a specific reason and next step

Why it matters:
- Proves restraint and trustworthiness
- Makes escalation quality visible instead of treating it as failure noise

Formula:
- count of tickets escalated with structured reason code and handoff note

### 5. Escalation quality rate
Definition:
- Share of escalated tickets that include a valid reason, policy condition, and next action for the human

Why it matters:
- Trust comes from good stops, not just good actions

Formula:
- escalations with complete handoff record / total escalations

Target interpretation:
- Should be near 100 percent

### 6. Average completion time
Definition:
- Time from ticket creation or pilot intake to completion for automated tickets

Why it matters:
- Shows speed improvement in a way buyers actually care about

Formula:
- average of completed_at minus created_at for automated completions

Comparison view:
- baseline human handling time vs pilot automated completion time

### 7. Queue hours removed
Definition:
- Hours of repetitive ticket handling taken off the human team

Why it matters:
- Converts ticket count into operational relief

Formula:
- automated completions x baseline average handling minutes / 60

### 8. Morning backlog reduction
Definition:
- Reduction in open in-scope tickets present at the agreed morning checkpoint

Why it matters:
- This is the clearest expression of overnight queue clearance

Formula:
- baseline average morning backlog minus pilot average morning backlog

Recommended checkpoint:
- same local time each business day, for example 8:00 AM local service desk time

### 9. SLA risk reduction
Definition:
- Change in the number or share of in-scope tickets approaching or breaching SLA

Why it matters:
- Connects faster execution to service quality, not just labor savings

Formula:
- baseline at-risk or breached in-scope tickets minus pilot at-risk or breached in-scope tickets

### 10. Failure / rollback count
Definition:
- Tickets where TierZero action failed, had to be rolled back, or produced an incorrect terminal result

Why it matters:
- Keeps trust honest
- Prevents a shiny dashboard from hiding operational damage

Formula:
- count of actions with failed, rolled_back, or incorrect_outcome status

Target interpretation:
- Should stay visibly low and trend down

## Baseline vs current views

### Baseline panel
Show the pre-pilot state for the same workflow class:
- average eligible tickets per day or week
- average human handling time
- average morning backlog
- average SLA-risk count
- manual completion count

### Pilot current panel
Show pilot-to-date:
- eligible tickets
- automated completions
- automation rate
- clean escalations
- average completion time
- morning backlog reduction
- queue hours removed
- SLA risk reduction
- failure / rollback count

### Side-by-side comparison cards
Every important metric should answer one of these forms:
- **Before:** X
- **Now:** Y
- **Change:** delta and percent where helpful

Avoid decorative charts that do not change a decision.

## Minimum dashboard panels

### Panel 1. Executive summary strip
Five cards only:
- morning backlog reduction
- automation rate
- average completion time improvement
- queue hours removed
- failure / rollback count

### Panel 2. Workflow funnel
A simple funnel for the selected period:
- tickets received
- tickets eligible
- tickets automated
- tickets escalated
- tickets failed / rolled back

This makes scope discipline visible.

### Panel 3. Speed comparison
Show:
- baseline average handling time
- pilot automated completion time
- time saved per ticket

Optional trend:
- daily or weekly completion time trend during the pilot

### Panel 4. Trust and control
Show:
- clean escalations
- escalation quality rate
- top escalation reasons
- failure / rollback count
- audit coverage rate

Audit coverage rate definition:
- percent of automated or escalated tickets with a complete record of decision, action or stop reason, timestamp, system touched, and next step

### Panel 5. Queue impact over time
Show daily or weekly:
- morning in-scope backlog
- automated completions
- SLA-risk count

This is the visual proof that the morning queue is shrinking.

## Required event and data inputs
The dashboard only needs a small event model.

### Ticket-level fields
Required fields per ticket:
- ticket_id
- created_at
- queue_name
- workflow_type
- requester_type
- target_system
- priority
- sla_due_at
- resolved_at
- final_status

### Scope and decision fields
- in_scope true or false
- out_of_scope_reason
- policy_check_status
- privileged_account_flag
- required_fields_complete true or false

### Execution fields
- action_attempted true or false
- action_type reset or unlock
- action_started_at
- action_finished_at
- action_result success, failed, rolled_back
- downstream_system

### Escalation fields
- escalated true or false
- escalation_reason_code
- escalation_note_present true or false
- escalation_next_step_present true or false
- escalated_at

### Audit fields
- audit_record_present true or false
- audit_timestamp_present true or false
- audit_system_present true or false
- audit_result_present true or false
- audit_next_step_present true or false

### Baseline inputs
For the pre-pilot comparison, collect at minimum:
- historical volume of the same workflow class
- average human handling time
- morning backlog count
- SLA-risk or breach count

## Metric rules
To keep the pilot honest:
- Do not count out-of-scope tickets as automation misses
- Do not count partially assisted tickets as automated completions
- Do not hide escalations - structured escalation is a positive trust signal
- Do not report labor savings without pairing it with queue and SLA impact
- Do not roll multiple workflows into the same scoreboard during the first pilot

## What proves success in the pilot
The dashboard should make expansion feel obvious if the buyer sees:
- a meaningful share of eligible tickets completed autonomously
- materially faster completion than the baseline process
- a smaller morning backlog for the in-scope queue
- low failure or rollback volume
- clean, reviewable escalation behavior

## Mockup guidance
If this becomes a mockup next, keep it brutally simple:
- one screen
- top-line outcome first
- funnel second
- trust panel third
- trend chart last

The buyer should understand the value in under 30 seconds.

## Non-goals
This dashboard is not for:
- token counts
- model latency trivia
- prompt quality metrics
- generic chatbot engagement
- broad cross-workflow reporting

If a metric does not help sell queue reduction, speed, or trust, cut it.
