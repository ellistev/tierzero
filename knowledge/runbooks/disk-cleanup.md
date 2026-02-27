# Disk Space Cleanup Runbook

## When to use
When a server or workstation is critically low on disk space (< 10% free) or a user reports
"disk full" errors, failed backups, or application crashes due to insufficient space.

## Windows workstation

1. Run Disk Cleanup: `cleanmgr /d C:` -- select all categories including system files
2. Clear Windows Update cache: `net stop wuauserv && rd /s /q C:\Windows\SoftwareDistribution\Download && net start wuauserv`
3. Delete temp files: `del /q /f /s %TEMP%\*`
4. Check for large files: `dir C:\ /s /o-s | more` or use WinDirStat
5. Empty Recycle Bin for all users: `rd /s /q C:\$Recycle.Bin`
6. Compress old files if space is still needed (right-click → Properties → Advanced → Compress)

## Windows server

1. Check current usage: `Get-PSDrive C | Select Used, Free`
2. IIS logs (often the culprit): `C:\inetpub\logs\LogFiles` -- safe to delete logs older than 90 days
3. Windows Event logs: `wevtutil cl Application && wevtutil cl System`
4. SQL Server: check if tempdb or log files have grown unchecked -- escalate to DBA if so
5. ShadowCopy / VSS: `vssadmin list shadows` -- remove old snapshots if safe: `vssadmin delete shadows /all /quiet`

## Linux / macOS

1. Check usage: `df -h` and `du -sh /* | sort -h`
2. Clear package cache: `apt clean` (Ubuntu) or `yum clean all` (RHEL)
3. Find and remove large log files: `find /var/log -name "*.log" -size +100M`
4. Truncate (don't delete) active log files: `truncate -s 0 /var/log/syslog`
5. Remove old Docker images/containers: `docker system prune -a` (confirm with owner first)
6. Rotate journals: `journalctl --vacuum-size=500M`

## When to escalate
- SQL database log files growing rapidly → DBA team
- Application data directory is full → application owner
- SAN / NFS volume issue → Storage team
- Pattern repeats (disk fills within days) → investigate root cause before resolving

## Monitoring
After cleanup, if disk was at a critical threshold, add a monitoring alert:
- Windows: use Performance Monitor or set up a Task Scheduler alert
- Linux: add to Nagios/Prometheus with threshold at 80% for warning, 90% for critical
