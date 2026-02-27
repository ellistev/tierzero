# Software Installation & Deployment Runbook

## Scope
Software installation requests, approved application deployment, and troubleshooting failed installs on Windows endpoints.

## Policy Summary
- **Standard software** (on the approved list): IT can install without manager approval
- **Non-standard / paid software**: requires manager approval + procurement
- **Admin rights**: users do NOT get local admin by default; IT installs centrally or via self-service portal

---

## Self-Service Options (User Can Do This)

Direct users here first to reduce ticket volume:

| Portal | What's Available |
|---|---|
| **Company Software Center** (SCCM/Intune) | All approved apps — user clicks Install |
| **Microsoft Store for Business** | Approved Microsoft Store apps |
| **Office.com / Microsoft 365 Apps** | Office installation (if licensed) |

If the software isn't in the Software Center, IT must deploy it.

---

## Check if Software Is Already Installed

```powershell
# Quick check
Get-Package -Name "*zoom*" -ErrorAction SilentlyContinue

# More thorough (registry)
Get-ChildItem "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\",
              "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\" |
  Get-ItemProperty | Where-Object {$_.DisplayName -like "*zoom*"} |
  Select-Object DisplayName, DisplayVersion, Publisher
```

---

## Remote Installation via PowerShell / PSRemoting

```powershell
# Copy installer to remote machine and run silently
$target = "WORKSTATION01"
$installer = "\\fileserver\software\zoom\ZoomInstaller.exe"

# Run installer remotely (silent flags vary by vendor -- see below)
Invoke-Command -ComputerName $target -ScriptBlock {
    param($src)
    Start-Process $src -ArgumentList "/silent /norestart" -Wait
} -ArgumentList $installer
```

### Common silent install switches

| Software | Silent Switch |
|---|---|
| Microsoft Office 365 / M365 | `setup.exe /configure config.xml` |
| Zoom | `ZoomInstaller.exe /silent /norestart` |
| Slack | `slack-setup.exe -s` |
| Adobe Reader | `AcroRdrDC.exe /sAll /rs /rps /msi EULA_ACCEPT=YES` |
| 7-Zip | `7z-installer.exe /S` |
| VLC | `vlc-installer.exe /L=1033 /S` |
| Chrome | `googlechromestandaloneenterprise64.msi /quiet /norestart` |
| Firefox | `Firefox Setup.msi /quiet /norestart` |
| Java | `jre-installer.exe /s REBOOT=Suppress` |
| Python | `python-installer.exe /quiet InstallAllUsers=1 PrependPath=1` |

---

## SCCM / Intune Deployment (IT Admin)

### SCCM
1. **Software Library → Application Management → Applications → Create Application**
2. Upload MSI/EXE, configure detection method (registry key or file existence)
3. Deploy to device collection or user collection
4. Force sync on client: `Invoke-WmiMethod -Namespace "root\ccm" -Class "SMS_Client" -Name "TriggerSchedule" -ArgumentList "{00000000-0000-0000-0000-000000000021}"`

### Intune / Microsoft Endpoint Manager
1. **Apps → All Apps → Add → Line-of-business app (or Win32 app)**
2. Package as `.intunewin` using `IntuneWinAppUtil.exe`:
   ```
   IntuneWinAppUtil.exe -c C:\AppSource -s setup.exe -o C:\Output
   ```
3. Set install command, uninstall command, and detection rules
4. Assign to device or user group

---

## Troubleshoot Failed Installations

### Check Windows Installer log
```powershell
# Enable verbose MSI logging for a specific install:
msiexec /i "setup.msi" /L*V "C:\Temp\install_log.txt"

# Look for "Return value 3" (error) or "Error" in the log
Select-String -Path "C:\Temp\install_log.txt" -Pattern "Return value 3|error" -CaseSensitive:$false
```

### Common failure reasons and fixes

| Error | Cause | Fix |
|---|---|---|
| Error 1603 | Generic MSI failure | Check install log; often .NET or VC++ dependency missing |
| Error 1618 | Another install in progress | Wait or kill `msiexec.exe` process |
| Error 1719 | Windows Installer broken | `msiexec /unregister` then `msiexec /regserver` |
| Error 5 / Access denied | Insufficient permissions | Run as admin or use SCCM/Intune deployment |
| 0x80070643 | .NET install failed | Install/repair .NET Framework via Windows Update |
| Side-by-side error | VC++ runtime conflict | Install missing VC++ Redistributable from Microsoft |

### Repair corrupted Windows Installer
```powershell
# Re-register Windows Installer service
Stop-Service msiserver -Force
Start-Sleep 2
msiexec /unregister
msiexec /regserver
Start-Service msiserver
```

---

## Uninstalling Software Remotely

```powershell
# Find the uninstall string from registry
$app = Get-ChildItem "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\" |
  Get-ItemProperty | Where-Object {$_.DisplayName -like "*Zoom*"}

# Run the uninstall string silently
$uninstallString = $app.UninstallString
Start-Process cmd -ArgumentList "/c $uninstallString /silent" -Wait

# OR use msiexec with the product GUID:
msiexec /x "{PRODUCT-GUID}" /quiet /norestart
```

---

## Escalation Triggers

Escalate to **Application Owner / App Team** if:
- Installation repeatedly fails and the error points to a license or server-side issue
- Application requires backend configuration (database connection, license server)

Escalate to **Infrastructure Ops** if:
- SCCM Distribution Point is unreachable
- Software Center shows no content (DP sync issue)

Requires manager approval + separate procurement ticket for:
- Any paid/licensed software not already in the catalog
- Software requiring a security review (new vendors, cloud SaaS tools)

---

## Related

- Policy: Software Acceptable Use Policy, Software Procurement Policy
- Escalation: infra@company.com (SCCM/Intune infrastructure)
