# TierZero Pilot ROI Calculator

Use this in live calls. Keep it simple and brutal.

## Inputs

### Ticket volume
- Repetitive tickets per week in chosen workflow: `_____`
- Percent of those tickets suitable for automation in pilot: `_____ %`

### Labor cost
- Average handling time per ticket: `_____ minutes`
- Fully loaded labor cost per hour for the team: `$_____`

### Queue pain
- Current overnight / morning backlog for this ticket class: `_____`
- Current SLA breach or risk on this ticket class: `_____`

### Pilot pricing
- Setup fee: `$_____`
- Monthly pilot fee: `$_____`
- Pilot duration in months: `_____`

---

## Core calculations

### 1. Tickets automated per month
`weekly ticket volume x automation % x 4.33`

### 2. Hours saved per month
`tickets automated per month x handling time / 60`

### 3. Labor dollars saved per month
`hours saved per month x loaded labor cost`

### 4. Pilot cost
`setup fee + (monthly pilot fee x months)`

### 5. Gross pilot value
`labor dollars saved during pilot`

### 6. Expansion value
Use once multiple workflows are added.

`monthly labor dollars saved x 12`

---

## Fast back-of-napkin example

### Example inputs
- 400 repetitive tickets / week
- 35 percent automatable in phase one
- 12 minutes average handling time
- $45 loaded labor cost per hour
- Setup fee $20,000
- Monthly pilot fee $7,500
- 2 month pilot

### Math
1. Tickets automated per month  
`400 x 0.35 x 4.33 = 606`

2. Hours saved per month  
`606 x 12 / 60 = 121.2 hours`

3. Labor dollars saved per month  
`121.2 x 45 = $5,454`

4. Pilot cost  
`20,000 + (7,500 x 2) = $35,000`

### What this means
On labor savings alone, that pilot does **not** fully pay back yet.

So do not sell the pilot on labor alone.

Sell it on:
- reduced backlog
- faster response times
- after-hours queue control
- proving safe automation in one workflow
- expansion value once 3-5 workflows are live

---

## Expansion example
If the customer expands from one workflow to five similar workflows:
- 3,000 automatable tickets / month
- 600 hours saved / month
- `$27,000` labor value / month at `$45/hr`
- `$324,000` annual labor value before SLA and backlog upside

That is where the business starts to get interesting.

---

## Sales rule
Do not bullshit the math.

If the first workflow is too small, say so.
If the queue pain is not expensive enough, move on.
If the expansion case is not obvious, it is the wrong account.

The right account has:
- enough ticket volume
- enough repeatability
- enough labor cost
- enough backlog pain
- enough workflow adjacency to expand after the pilot
