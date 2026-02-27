# Disk Cleanup Runbook

## Scope
Windows endpoints and Windows servers. Low-disk-space alerts and user-facing "disk full" errors.

## Symptoms
- "You are running out of disk space on Local Disk (C:)" notification
- Applications failing to save files ("There is not enough space on the disk")
- Windows Update failing with 0x80070070 or similar out-of-space error
- Event ID 2013 in Event Viewer (disk space low on server)
- Slow performance (Windows needs ~15% free space for temp files and virtual memory)

**Immediate threshold:** Alert IT when C: has < 5 GB free. Critical when < 2 GB.

---

## Step 1 — Assess Current Usage

```powershell
# Check all drives
Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N="Used(GB)";E={[math]::Round($_.Used/1GB,1)}}, @{N="Free(GB)";E={[math]::Round($_.Free/1GB,1)}}

# Find the largest folders on C:
Get-ChildItem C:\ -Recurse -ErrorAction SilentlyContinue |
  Group-Object DirectoryName |
  Select-Object Name, @{N="Size(MB)";E={[math]::Round(($_.Group | Measure-Object Length -Sum).Sum/1MB,1)}} |
  Sort-Object "Size(MB)" -Descending |
  Select-Object -First 20
```

Use **TreeSize Free** or **WinDirStat** for a visual breakdown if available.

---

## Step 2 — Safe Automated Cleanup (run first, no data loss risk)

### Windows Disk Cleanup (GUI)
1. Press `Win+R` → type `cleanmgr /sageset:100` → OK (opens advanced options)
2. Check all boxes including "Clean up system files"
3. Press `Win+R` → `cleanmgr /sagerun:100` → wait for completion

### PowerShell cleanup (safe folders)
```powershell
# Run as Administrator
$paths = @(
    "C:\Windows\Temp\*",
    "$env:TEMP\*",
    "C:\Windows\SoftwareDistribution\Download\*"   # Windows Update cache
)
foreach ($p in $paths) {
    Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Cleaned: $p"
}

# Empty Recycle Bin for all users
Clear-RecycleBin -Force -ErrorAction SilentlyContinue

# Clean WinSxS component store (safe -- removes superseded components only)
Dism.exe /Online /Cleanup-Image /StartComponentCleanup /ResetBase
```

**Expected reclaim:** 1–10 GB depending on Windows Update history.

---

## Step 3 — Windows Update Cleanup

Windows Update caches are often the largest consumer of disk space.

```powershell
# Stop Windows Update service to safely delete cache
Stop-Service wuauserv, bits -Force

# Delete download cache
Remove-Item "C:\Windows\SoftwareDistribution\Download\*" -Recurse -Force -ErrorAction SilentlyContinue

# Restart service
Start-Service wuauserv, bits
```

If `C:\Windows\WinSxS` is very large (> 20 GB):
```powershell
# Safe -- only removes components no longer needed after updates
DISM /Online /Cleanup-Image /StartComponentCleanup
```

---

## Step 4 — User Profile & Application Data

**Only proceed after confirming with the user.**

### Large file types to investigate:
```powershell
# Find files > 500 MB
Get-ChildItem C:\Users -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {$_.Length -gt 500MB} |
  Select-Object FullName, @{N="Size(GB)";E={[math]::Round($_.Length/1GB,2)}} |
  Sort-Object "Size(GB)" -Descending
```

### Common large locations:
| Folder | What's there | Action |
|---|---|---|
| `%LOCALAPPDATA%\Microsoft\Teams\` | Teams cache | Delete `Cache\`, `blob_storage\`, `databases\` |
| `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Cache` | Browser cache | Chrome Settings → Clear browsing data |
| `%APPDATA%\Zoom\` | Zoom recordings/logs | Delete `logs\`, old recordings in Documents/Zoom |
| `C:\Users\<user>\Downloads\` | Accumulated downloads | Review with user before deleting |
| `%LOCALAPPDATA%\Temp\` | Application temp files | Safe to delete all |
| `C:\ProgramData\Microsoft\Windows Defender\` | Defender quarantine | Open Defender → Protection History → Clear |

### Teams cache cleanup (PowerShell — closes Teams first):
```powershell
Get-Process Teams -ErrorAction SilentlyContinue | Stop-Process -Force
$teamsPaths = @(
    "$env:LOCALAPPDATA\Microsoft\Teams\Cache",
    "$env:LOCALAPPDATA\Microsoft\Teams\blob_storage",
    "$env:LOCALAPPDATA\Microsoft\Teams\databases",
    "$env:LOCALAPPDATA\Microsoft\Teams\GPUCache"
)
foreach ($p in $teamsPaths) {
    Remove-Item "$p\*" -Recurse -Force -ErrorAction SilentlyContinue
}
```
**Expected reclaim:** 500 MB – 5 GB.

---

## Step 5 — IIS / Application Logs (Servers Only)

```powershell
# Check IIS log size
Get-ChildItem "C:\inetpub\logs" -Recurse |
  Measure-Object -Property Length -Sum |
  Select-Object @{N="Size(GB)";E={[math]::Round($_.Sum/1GB,2)}}

# Archive logs older than 30 days (compress then delete)
Get-ChildItem "C:\inetpub\logs\LogFiles" -Recurse -File |
  Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-30)} |
  Remove-Item -Force
```

For application logs in `C:\ProgramData\` or `C:\Logs\`: consult the application owner before deleting.

---

## Step 6 — Page File / Hibernation

```powershell
# Disable hibernation (reclaims RAM-equivalent space -- safe for desktop/server, not laptops)
powercfg /hibernate off

# Page file: only adjust if disk is critically low AND RAM > 16 GB
# Do NOT disable completely -- Windows needs at least a small page file
```

---

## Escalation Triggers

Escalate to **Infrastructure Ops** if:
- This is a server (not a workstation)
- Disk is a SAN/NAS volume (needs storage team involvement)
- Cleanup did not reclaim enough space and a disk extension is needed
- Automated cleanup failed with errors (permissions, VSS issues)

**Do not delete:** Page file, hibernation file on production servers, application data folders, database files, anything in `C:\Windows\System32`.

---

## Prevention

- Enable disk space alerts via monitoring (alert at 85% full, critical at 95%)
- Schedule monthly Disk Cleanup via Task Scheduler using the `/sagerun:100` parameter
- Consider redirecting Desktop/Documents to OneDrive or a file server
- Review and cap log retention policies for server applications

---

## Related

- Policy: Data Retention Policy
- Escalation: infra@company.com (server volumes, SAN), fieldservices@company.com (workstation hardware upgrade)
