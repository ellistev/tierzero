# Email Issues Runbook

## Scope
Microsoft 365 / Exchange Online email issues for end users.
Covers Outlook desktop (Windows/Mac), Outlook Web Access (OWA), and mobile.

## Common Symptoms
- Outlook stuck on "Connecting..." or "Disconnected"
- Emails not sending / stuck in Outbox
- Not receiving emails (but others on the org can)
- "Your mailbox is almost full" warning
- Missing emails or folders
- Outlook keeps asking for password
- New machine — Outlook not configured
- Calendar invites not syncing

---

## Quick Triage

Ask the user:
1. Is OWA working? (https://outlook.office.com) — if yes, the problem is Outlook client, not the server
2. What Outlook version and Windows version?
3. When did it start? Any recent changes (password reset, new device, Windows Update)?
4. Does it affect just them or their whole team?

---

## Fix: Outlook Stuck on "Connecting" / "Disconnected"

### Step 1 — Basic checks
```powershell
# Is Outlook the right version?
(Get-Command outlook.exe).FileVersionInfo.FileVersion
# M365 Outlook should be 16.x

# Check if Microsoft 365 services are up:
# https://status.office.com or https://admin.microsoft.com/servicestatus
```

### Step 2 — Repair Office
1. **Control Panel → Programs → Microsoft 365 → Change → Quick Repair**
2. If Quick Repair fails, run **Online Repair** (requires internet)
3. PowerShell alternative:
   ```powershell
   # Quick repair (Office Click-to-Run)
   "C:\Program Files\Common Files\microsoft shared\ClickToRun\OfficeC2RClient.exe" /repair
   ```

### Step 3 — Rebuild the Outlook profile
1. Close Outlook
2. Open Control Panel → Mail (32-bit) → Show Profiles → Remove the existing profile
3. Create a new profile with the user's email address
4. Outlook will auto-discover settings for M365

---

## Fix: Emails Stuck in Outbox

1. Open Outlook in offline mode: **Send/Receive → Work Offline**
2. Open Outbox folder → delete or move the stuck emails
3. Turn off Work Offline → let Outlook reconnect
4. Re-send the emails

If messages keep getting stuck:
- Check for oversized attachments (M365 limit: 25 MB by default)
- Check for blocked file types (`.exe`, `.zip` with executables)
- Open the stuck email and check if it has an invalid To: address

---

## Fix: Not Receiving Emails

### Step 1 — Check spam/junk folder
- Outlook: Junk Email folder
- OWA: Junk Email
- Also check: **Quarantine portal** https://security.microsoft.com → Email & Collaboration → Review → Quarantine

### Step 2 — Check mail flow rules (admin)
1. Open **Exchange Admin Center** → Mail flow → Rules
2. Look for rules that redirect or delete messages for this user
3. Also check in **Outlook Rules** (in the client): Home → Rules → Manage Rules & Alerts

### Step 3 — Check mailbox forwarding (admin)
```powershell
# Check if email is being auto-forwarded externally (security risk -- check this)
Get-Mailbox -Identity "jsmith@contoso.com" | Select-Object ForwardingAddress, ForwardingSmtpAddress, DeliverToMailboxAndForward
```
If unexpected forwarding is set → escalate to **Security**.

### Step 4 — Check message trace (admin)
1. **Exchange Admin Center → Mail flow → Message trace**
2. Search for emails sent to the user in the last 24h
3. Status: "Delivered" = arrived; "Failed" = bounced; "FilteredAsSpam" = quarantined

---

## Fix: "Mailbox Almost Full" / Quota Warning

M365 default mailbox quota: 50 GB (Exchange Online Plan 1) or 100 GB (Plan 2).

### User actions:
1. Empty **Deleted Items** and **Junk Email**
2. Archive old emails: **File → Cleanup Tools → Archive** or enable Auto-Archive
3. Large attachments: search Outlook by size → Home → Search → Refine → Larger than 5 MB → delete or save to OneDrive

### IT admin actions:
```powershell
# Check current mailbox size
Get-MailboxStatistics -Identity "jsmith@contoso.com" | Select-Object TotalItemSize, ItemCount

# Increase quota (if license allows):
Set-Mailbox -Identity "jsmith@contoso.com" -ProhibitSendReceiveQuota 60GB -ProhibitSendQuota 58GB -IssueWarningQuota 55GB

# Enable Online Archive (requires Exchange Online Plan 2 or M365 E3):
Enable-Mailbox -Identity "jsmith@contoso.com" -Archive
```

---

## Fix: Outlook Keeps Asking for Password

Common causes: Modern Authentication disabled, cached credentials stale, or MFA forced.

```powershell
# Check if Modern Authentication is enabled on the tenant (admin):
Get-OrganizationConfig | Select-Object OAuth2ClientProfileEnabled
# Should be True

# On the user's machine:
# 1. Remove cached credentials:
#    Control Panel → Credential Manager → Windows Credentials
#    Remove all entries with "outlook", "mso", "microsoftonline"

# 2. Sign out of Office:
#    File → Office Account → Sign Out → restart Outlook
```

If MFA is newly enforced and the user hasn't set it up: direct them to https://aka.ms/mfasetup

---

## Fix: Set Up Outlook on a New Machine

1. Open Outlook → File → Add Account
2. Enter the user's email address → **Connect**
3. For M365: auto-discover handles the rest. Sign in with M365 credentials.
4. If auto-discover fails (on-prem Exchange):
   - Server: `mail.contoso.com`
   - Use **Exchange (not IMAP/POP)** for full calendar/contacts sync

---

## Fix: Calendar Invites Not Syncing

1. Verify the user has the **Calendar** folder (sometimes missing if mailbox was migrated)
2. Trigger a sync: **Ctrl+Shift+F9** (Send/Receive All)
3. Clear the calendar cache: delete `%AppData%\Microsoft\Outlook\*.nst` and restart Outlook
4. If a shared calendar is missing: remove and re-add via People → Shared Calendars

---

## Escalation Triggers

Escalate to the **Exchange / M365 Admin** team if:
- Mail flow rules need creating or tenant-level settings need changing
- Mailbox license upgrade required
- Mailbox migration issue (failed or incomplete migration)
- External email not being received (MX record or SPF/DKIM issue)

Escalate to **Security** if:
- Unexpected email forwarding rules found (possible account compromise)
- User reports phishing / account takeover attempt
- Business Email Compromise (BEC) suspected

---

## Related

- Policy: Email Acceptable Use Policy, Data Classification Policy
- Escalation: infra@company.com (Exchange infra), security@company.com (compromise)
