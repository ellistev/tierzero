# SGI Escalation Matrix

## Auto-Resolvable (agent handles fully)
- Bind Failure tickets with standard three-failure pattern (SendBoundQuoteToDrive + SendPaymentRequestToInsurCloud + SendPaymentToDrive all Failed)
- Plate number lookups
- ID cross-reference queries

## Requires Manual Review
- ACL Command Queue shows non-standard failure patterns
- Bind or payment operations time out after 3 minutes
- JSON attachment missing from ticket
- KQL query returns no results
- Multiple failed retries on the same ticket

## Escalate Immediately
- Tickets involving financial discrepancies
- Issues affecting multiple registrations simultaneously
- System-wide failures (multiple tickets with same root cause)
- Anything involving customer PII beyond what's needed for the repair
