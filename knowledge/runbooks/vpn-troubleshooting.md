# VPN Troubleshooting Runbook

## Common symptoms
- "Unable to connect to VPN"
- "VPN connects but no internal resources accessible"
- "VPN disconnects frequently"
- "Authentication failed" on VPN client

## Quick diagnosis checklist

1. Is the user's internet connection working? (browse to google.com)
2. What VPN client? (GlobalProtect, Cisco AnyConnect, or WireGuard)
3. What error message exactly?
4. Did it work before? If yes, what changed? (new laptop, OS update, location)
5. Is the user on corporate or personal device?

## Fixes by error type

### "Authentication failed"
- Check if the user's AD password recently expired -- redirect to password-reset runbook
- Check if the user's VPN access group is correct in AD: `VPN-Users` or `VPN-Contractors`
- If using certificate auth: certificate may have expired -- re-enroll via IT portal

### "Unable to connect" (connection timeout)
- Firewall issue: confirm ports 443 (SSL-VPN) or 1194 (OpenVPN) are not blocked by ISP
- Try from a different network (mobile hotspot test)
- Check VPN gateway status: https://vpnstatus.internal (requires VPN -- check IT status page instead)
- For GlobalProtect: try "Connect Before Logon" mode

### "Connected but no resources"
- Split-tunnel issue: check VPN routing table with `route print` (Windows) or `netstat -rn` (Mac/Linux)
- DNS resolution: try `nslookup intranet.company.com` -- should resolve to 10.x.x.x range
- Firewall posture check failed: user's device may not meet security policy (missing AV, outdated OS)

### Frequent disconnections
- Check for IP conflicts on local network
- Power management: disable "Allow computer to turn off device to save power" on the network adapter
- Corporate WiFi + VPN conflict: advise user to use wired connection

## Escalation
If none of the above resolves the issue:
1. Collect: OS version, VPN client version, error screenshot, and traceroute to vpn.company.com
2. Escalate to Network Engineering with ticket tagged `vpn` and `network-team`

## Resolution template
> Hi [Name], to fix your VPN issue: [SPECIFIC_STEPS].
> Please try reconnecting and let us know if the issue persists.
