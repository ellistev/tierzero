# Password Reset Runbook

## Scope
Active Directory (on-prem AD), Azure AD / Entra ID, and ADFS-federated accounts.

## Symptoms
- "Your password has expired" at Windows login
- "Account locked out" at login
- Unable to authenticate to any Microsoft 365 app (Teams, Outlook, SharePoint)
- MFA prompt loops or fails after password change
- User receives email: "Your password will expire in X days"

---

## Self-Service Reset (preferred — no agent action required)

Direct the user to one of the following based on their environment:

| Environment | Self-Service URL |
|---|---|
| Azure AD / M365 | https://aka.ms/sspr |
| On-prem AD (with SSPR proxy) | https://passwordreset.microsoftonline.com |
| On-prem only | Contact IT — no self-service available |

**Prerequisites for SSPR to work:**
- User must have a registered mobile number or alternate email in their profile
- If not registered, IT must reset manually (see below)

---

## Manual Reset — Azure AD (Entra ID)

**Required role:** User Administrator or Global Administrator (or Helpdesk Administrator for non-admin accounts)

1. Open **Azure Portal** → **Microsoft Entra ID** → **Users**
2. Search for the user by name or UPN (e.g. `jsmith@contoso.com`)
3. Click the user → **Reset password** (top toolbar)
4. Tick **Auto-generate password** or enter a temporary password
5. Tick **Require this user to change their password on next sign-in** ✓
6. Click **Reset**
7. Securely deliver the temporary password to the user (phone call or in-person — NOT email)
8. Advise the user to sign in at https://portal.office.com and change their password immediately
9. If MFA is stuck in a loop: click **Authentication methods** → delete all methods → have user re-register

---

## Manual Reset — On-Premises Active Directory

**Required tool:** Active Directory Users and Computers (ADUC) or PowerShell with RSAT

### ADUC (GUI)
1. Open **Active Directory Users and Computers**
2. Find the OU containing the user (or use Find: Ctrl+F → search by name)
3. Right-click the user → **Reset Password**
4. Enter and confirm a temporary password (must meet complexity requirements)
5. Tick **User must change password at next logon** ✓
6. If account is locked out: also tick **Unlock the user's account** ✓
7. Click **OK**

### PowerShell
```powershell
# Reset password
Set-ADAccountPassword -Identity "jsmith" -Reset -NewPassword (ConvertTo-SecureString "Temp@12345" -AsPlainText -Force)

# Force change at next login
Set-ADUser -Identity "jsmith" -ChangePasswordAtLogon $true

# Unlock if locked
Unlock-ADAccount -Identity "jsmith"

# Verify
Get-ADUser -Identity "jsmith" -Properties LockedOut, PasswordExpired, PasswordLastSet
```

---

## Account Lockout Investigation

If the account keeps locking again within minutes, there is a stored credential somewhere:

1. Run `Get-ADUser jsmith -Properties BadLogonCount, LockedOut, BadPasswordTime` to confirm lockout
2. Check for scheduled tasks or mapped drives using old credentials
3. On the user's PC: **Credential Manager** (Control Panel) → remove any stored Windows Credentials for the domain
4. Check Exchange ActiveSync devices: **Exchange Admin Center** → Mailboxes → [user] → Mobile Devices — remove old devices
5. Check if the user has multiple active sessions on VMs or Citrix with stale credentials

---

## Post-Reset Verification

1. Have the user sign in at a browser (not Windows login) to verify credentials work
2. Confirm no MFA re-registration loop (if so, clear authentication methods as above)
3. If on-prem + hybrid joined: allow 5-10 minutes for AD Connect sync before Azure password propagates
4. For Outlook/Teams: user may need to sign out and back in on each device

---

## Escalation Triggers

Escalate to **Security** team if:
- Account shows signs of compromise (logins from unexpected geography, MFA fatigue attack)
- User reports they did NOT initiate a password reset
- Account is a service account or admin account

Escalate to **Infrastructure Ops** if:
- AD Connect sync is failing (Azure and on-prem out of sync)
- Domain controller is unreachable

---

## Related

- Runbook: Account Lockout (repeated lockouts, compromise)
- Policy: Account Management Policy
- Escalation matrix: security@company.com (compromise), infra@company.com (AD/DC issues)
