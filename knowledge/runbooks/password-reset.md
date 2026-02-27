# Password Reset Runbook

## When to use
Use this runbook when a user cannot log in due to a forgotten, expired, or locked password.
Applies to: Active Directory accounts, ServiceNow portal accounts, VPN access.

## Steps

### Self-service (preferred)
1. Direct the user to https://passwordreset.company.com
2. They enter their employee email and complete MFA verification
3. They set a new password (min 12 chars, must include uppercase, number, and symbol)
4. Password takes effect immediately -- no IT action required

### Helpdesk-assisted reset (if self-service fails)
1. Verify the user's identity: ask for employee ID and manager's name
2. Open Active Directory Users and Computers (ADUC)
3. Search for the user account
4. Right-click → Reset Password
5. Set a temporary password (format: `Temp@<last4ofEmpID>!`)
6. Check "User must change password at next logon"
7. If account is locked: right-click → Properties → Account tab → uncheck "Account is locked out"
8. Communicate the temporary password via phone (never email)
9. Ask the user to log in and change their password within 4 hours

### MFA issues alongside password reset
- If the user also lost MFA access, escalate to the Security team (see escalation-matrix.md)
- Do NOT disable MFA -- route to Security

## Common errors

**"Account not found"** -- Check if the user is in the correct OU. New hires may not be provisioned yet; check with HR.

**"Cannot reset password -- minimum age"** -- Password was changed too recently. Wait 24 hours or escalate to an AD admin.

**"Account disabled"** -- Do NOT re-enable without manager approval. Create a ticket to the manager for confirmation.

## Resolution template

> Hi [Name], your password has been reset. Your temporary password is [TEMP_PASSWORD].
> Please log in at [login-url] and change it within 4 hours.
> If you have any issues, reply to this ticket.
