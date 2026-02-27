# Account Lockout Runbook

## Scope
Repeated or suspicious Active Directory / Azure AD account lockout events.
For a simple one-time reset, see the Password Reset runbook.

## Symptoms
- User locked out multiple times per day even after password reset
- User swears they haven't changed their password
- Multiple devices or services reporting auth failures
- Lockout event (Event ID 4740) appearing in Security log

---

## Immediate Action — Unlock the Account

```powershell
Unlock-ADAccount -Identity "jsmith"
Get-ADUser "jsmith" -Properties LockedOut, BadLogonCount, BadPasswordTime, LastBadPasswordAttempt
```

Or via Azure Portal: **Entra ID → Users → [user] → Reset password → Unlock**.

---

## Find the Source of Lockouts

### Step 1 — Check the PDC Emulator DC

Lockout events are always logged on the PDC emulator (even if the lockout came from another DC):
```powershell
# Find the PDC Emulator
$pdc = (Get-ADDomain).PDCEmulator

# Search Security log for lockout events (4740) for this user
Get-WinEvent -ComputerName $pdc -FilterHashtable @{
    LogName = 'Security'
    Id = 4740
    StartTime = (Get-Date).AddHours(-24)
} | Where-Object { $_.Properties[0].Value -eq "jsmith" } |
  Select-Object TimeCreated, @{N="CallerPC";E={$_.Properties[1].Value}}
```

**CallerPC** tells you the machine or service that triggered the lockout.

### Step 2 — Trace the Calling Machine

Once you have the CallerPC:
1. RDP / remote into that machine
2. Check **Event Viewer → Windows Logs → Security** for Event ID **4625** (failed logons) — look for the username
3. Common sources:
   - **Mapped drives** using old credentials
   - **Scheduled tasks** running as the user
   - **Windows Credential Manager** with a stale cached password
   - **Exchange ActiveSync** / mobile device with old password

### Credential Manager (on user's PC)
1. Open **Control Panel → Credential Manager → Windows Credentials**
2. Look for entries containing the domain name or server names
3. Remove any entries related to the domain or Exchange server

### Scheduled Tasks
```powershell
# Check all scheduled tasks running as the affected user on CallerPC:
Get-ScheduledTask | Where-Object { $_.Principal.UserId -like "*jsmith*" } |
  Select-Object TaskName, TaskPath, @{N="RunAs";E={$_.Principal.UserId}}
```

Update any task credentials via Task Scheduler → right-click → Properties → Change User.

### Exchange ActiveSync Devices
1. Open **Exchange Admin Center** → Recipients → Mailboxes → [user] → Mobile Devices
2. Remove old or unrecognised device partnerships
3. Have the user update the password on any mobile device with Exchange configured

---

## Repeated Lockout — Security Checklist

If the user is being locked out from an **unknown machine** or at **odd hours**:

- [ ] Check if the account is being used as a service account somewhere (search AD for ServicePrincipalName)
- [ ] Review Azure AD Sign-In logs (Entra ID → Sign-ins → filter by user) for unexpected locations or apps
- [ ] Look for password spray pattern: many users locked out at the same time → escalate to **Security immediately**
- [ ] Check if MFA is enabled — if not, enable it as a mitigating control
- [ ] Consider temporarily disabling the account if compromise is suspected while investigating

---

## AD Fine-Grained Password Policy (FGPP) Check

If the lockout threshold seems too low (locking out after 3 attempts when policy says 10):
```powershell
# Check if FGPP applies to this user
Get-ADUserResultantPasswordPolicy -Identity "jsmith"
```
If a stricter PSO is applied, review whether it's intentional.

---

## Escalation Triggers

Escalate to **Security** team if:
- Lockout originates from unknown or external IP
- Sign-in logs show unexpected geography or unusual app access
- Multiple accounts being locked out simultaneously (password spray / credential stuffing attack)
- User is a privileged account (Domain Admin, Global Admin, service account)

---

## Related

- Runbook: Password Reset
- Policy: Account Management Policy, Acceptable Use Policy
- Escalation: security@company.com (suspected compromise), infra@company.com (DC/AD issues)
