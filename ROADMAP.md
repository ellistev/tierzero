# TierZero Product Roadmap

## Vision
TierZero builds itself. The system that resolves tickets IS the system being improved by tickets.

## Phase 1: Dogfood (TierZero builds TierZero)
- [x] GitHub Issues connector (same interface as ServiceNow/Jira)
- [ ] TierZero watches its own repo for open issues
- [ ] Agent picks up issue, writes code, runs tests, submits PR
- [ ] Human reviews and merges
- [ ] Every merged PR is a demo artifact

## Phase 2: First Paid Vertical - ServiceNow
- [ ] Record real SGI workflows (incident resolution, change requests)
- [ ] TierZero learns and replays them autonomously
- [ ] Pilot: autonomous ticket resolution on real ServiceNow instance
- [ ] Measure: tickets resolved, time saved, error rate

## Phase 3: Product Surface
- [ ] Landing page + marketing site
- [ ] CLI install: `npx tierzero`
- [ ] SaaS dashboard for monitoring agent work
- [ ] Pricing model: per-ticket-resolved

## Phase 4: Scale Verticals
- [ ] Jira (connector exists, needs browser skills)
- [ ] Zendesk connector + skills
- [ ] Freshdesk connector + skills
- [ ] Each vertical = new agent workload

## The Self-Improvement Loop
```
GitHub Issue created
  -> TierZero picks it up
  -> writes code + tests
  -> submits PR
  -> human merges
  -> TierZero is now better
  -> repeat
```
