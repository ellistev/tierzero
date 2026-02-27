# Escalation Matrix

## Team Routing (used by AI agent's escalateTo field)

| escalateTo key | Team Name | Contact | SLA |
|---|---|---|---|
| `security` | Security / InfoSec | security@company.com | P1: 1h (page on-call); P2: 4h |
| `networking` | Network Engineering | neteng@company.com | P1: 1h; P2: 4h |
| `infrastructure` | Infrastructure Ops | infra@company.com | P1: 2h; P2: 8h |
| `database` | DBA Team | dba@company.com | P1: 2h; P2: next-day |
| `desktop` | Field Services | fieldservices@company.com | Same-day (P1/P2), 3-day (P3/P4) |
| `application` | Application Owner (see CMDB) | per-app | Per app SLA |
| `identity` | Identity & Access (IAD) | identity@company.com | P1: 2h; P2: 4h |
| `email` | M365 / Exchange Admin | m365@company.com | P1: 2h; P2: 8h |

---

## Category → Team Mapping

| Issue Category | Team Key | Notes |
|---|---|---|
| Password reset, account lockout | `identity` | Self-service first (SSPR); escalate if compromise suspected → `security` |
| MFA setup, authenticator issues | `identity` | |
| VPN connectivity | `networking` | Network-side issues only; client-side stays with L1 |
| Network outage, DHCP, DNS, Wi-Fi | `networking` | |
| Firewall rule changes | `networking` + `security` | Dual approval required |
| Server / VM provisioning | `infrastructure` | |
| Storage / SAN / NAS | `infrastructure` | |
| AD / LDAP infrastructure | `infrastructure` | User account ops handled by `identity` |
| Database performance, access | `database` | |
| Disk / backup / disaster recovery | `infrastructure` | |
| Hardware failure / replacement | `desktop` | |
| Printer issues | `desktop` | |
| Software installation (non-SCCM) | `desktop` | |
| Application bugs / crashes | `application` | Identify app first from CMDB |
| M365 / Exchange / Teams issues | `email` | |
| SharePoint / OneDrive | `email` | |
| Security incident, malware, phishing | `security` | **Always P1** |
| Data breach or suspected compromise | `security` | **Page on-call immediately** |
| Business Email Compromise (BEC) | `security` | **Page on-call immediately** |

---

## Priority Definitions

| Priority | Label | Description | Target Response |
|---|---|---|---|
| P1 | Critical | Production down, data loss, active security incident, widespread outage | 1h |
| P2 | High | Significant business impact, single-user outage blocking work, workaround exists | 4h |
| P3 | Medium | Moderate impact, multiple users affected but workaround available | 8h (same business day) |
| P4 | Low | Minimal impact, cosmetic, cosmetic or convenience | 5 business days |

---

## When the AI Agent Escalates

The agent will escalate (rather than resolve automatically) when:

1. **Low confidence** — knowledge base confidence score is below 40%
2. **Physical access required** — hardware replacement, on-site work
3. **Policy approval required** — firewall rule changes, account re-enables for sensitive accounts, security exceptions
4. **Security incident** — any hint of compromise, malware, BEC, or data loss
5. **Multiple failed attempts** — the ticket thread already shows prior failed resolution attempts
6. **Out of scope** — issue type not covered by any runbook in the knowledge base

### What the agent does before escalating:

1. Posts an **internal note** containing:
   - Decision reasoning and confidence score
   - Knowledge base sources consulted
   - Suggested receiving team (`escalateTo` key)
   - Recommended next steps for the receiving team

2. Updates the ticket's **assigned group** (via updateTicket) if the `escalateTo` key matches a configured team sys_id

### Agent escalation note template:

```
## AI Agent Escalation

**Reasoning:** [step-by-step analysis]

**Suggested team:** [Team Name] — [escalateTo key]

**Notes for team:**
[Drafted context / recommended next steps / KB sources]
```

---

## Dual-Team Escalations

Some issues require involvement of two teams simultaneously:

| Scenario | Primary | Secondary | Coordination |
|---|---|---|---|
| Firewall rule for app fix | `networking` | `security` | Security reviews all firewall changes |
| Security incident on a server | `security` | `infrastructure` | Infra provides server access; Security leads investigation |
| Database compromise | `security` | `database` | DBA provides DB access logs; Security leads |
| BEC — email forwarding attack | `security` | `email` | Email removes forwarding rules; Security investigates |

For dual escalations: create a child ticket for the secondary team, link to the parent ticket, and add both teams to the internal note.

---

## On-Call Contacts (P1 only)

For P1 issues outside business hours (Mon–Fri 8am–6pm local):

- **Security**: Page via PagerDuty — policy requires 24/7 coverage
- **Networking**: On-call rotation — see PagerDuty schedule
- **Infrastructure**: On-call rotation — see PagerDuty schedule

**Do not call personal mobile numbers** — use PagerDuty or the on-call number in Slack #on-call-schedule.
