# Escalation Matrix

## Who handles what

| Category | Team | Contact | SLA |
|---|---|---|---|
| Identity / AD / MFA | Security | security@company.com | 4h |
| Network / VPN / Firewall | Network Engineering | neteng@company.com | 4h |
| Servers / Infrastructure | Infrastructure Ops | infra@company.com | 2h P1, 8h P2 |
| Databases (SQL, Postgres) | DBA Team | dba@company.com | 2h P1, next-day P2 |
| Applications | App owner (see CMDB) | -- | Per app SLA |
| Security incidents | Security / CISO | security@company.com | 1h -- page on-call |
| End-user hardware | Field Services | fieldservices@company.com | Same-day |

## Priority definitions

- **P1 (Critical):** Production down, data loss, security breach. Page on-call immediately.
- **P2 (High):** Significant business impact, workaround exists. 4h response.
- **P3 (Medium):** Moderate impact, user-level issue. Same business day.
- **P4 (Low):** Minimal impact, cosmetic. Next available sprint / 5 business days.

## When the AI agent escalates

The agent will escalate if:
- Confidence in the knowledge base resolution is below 40%
- The issue requires physical hardware access
- The issue requires policy approval (account re-enables, firewall rule changes)
- The issue involves a security incident or data breach
- Multiple failed resolution attempts are already in the ticket thread

## Escalation note format

The agent always posts an internal note before escalating containing:
- Its reasoning and confidence score
- KB sources it consulted
- Recommended next steps for the receiving team
