# Network Connectivity Troubleshooting Runbook

## Scope
End-user workstations and laptops unable to access the internet, internal resources, or specific services.
Covers wired Ethernet, Wi-Fi, and proxy-related issues.

## Symptoms
- "No internet access" (yellow triangle on network icon)
- Can access internet but not internal resources (or vice versa)
- Specific website or service unreachable
- Network connected but extremely slow
- "Limited connectivity" or APIPA address (169.254.x.x)

---

## Quick Diagnostic — Run These First

```powershell
# 1. What IP address does the machine have?
ipconfig /all

# 2. Can it reach its default gateway?
ping (Get-NetIPConfiguration).IPv4DefaultGateway.NextHop

# 3. Can it reach the internet?
Test-NetConnection 8.8.8.8 -Port 53

# 4. DNS resolution working?
Resolve-DnsName google.com
Resolve-DnsName intranet.contoso.com

# 5. Is the target service reachable on the right port?
Test-NetConnection sharepoint.contoso.com -Port 443
```

Use the results to identify at which layer the failure occurs.

---

## Fix: APIPA Address (169.254.x.x) — DHCP Not Working

The machine failed to get an IP from DHCP.

```powershell
# Release and renew
ipconfig /release
ipconfig /flushdns
ipconfig /renew

# If still failing, check if DHCP service is running locally
Get-Service Dhcp
```

If renew still fails:
1. Check physical cable / Wi-Fi signal
2. Try a different port on the switch
3. Check if DHCP scope is exhausted: **DHCP console → Scope → Address Leases** — escalate to **Network Engineering** if scope is full

---

## Fix: Has IP but No Internet — Gateway/DNS Issue

```powershell
# Can you reach the gateway?
ping 10.0.0.1  # substitute your actual gateway

# If ping to gateway fails: layer 2/physical issue or VLAN mismatch
# If ping succeeds but internet fails: check DNS and proxy
```

### DNS fix:
```powershell
# Flush stale DNS cache
ipconfig /flushdns

# Test with Google DNS directly (bypasses corporate DNS)
nslookup google.com 8.8.8.8

# If that works but corporate DNS fails:
nslookup google.com 10.0.0.10  # replace with your DNS server IP
```

If corporate DNS is unreachable → escalate to **Network Engineering** (DNS server issue).

### Set DNS manually (temporary workaround):
```powershell
# Set Google DNS on the active adapter (replace "Ethernet" with your adapter name)
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses ("8.8.8.8","8.8.4.4")
# REVERT after resolving root cause — this bypasses internal DNS
```

---

## Fix: Proxy Configuration Issues

Many corporate networks route HTTP/HTTPS through a proxy. If the proxy settings are wrong, HTTPS sites fail while internal sites may work.

```powershell
# Check current proxy settings
netsh winhttp show proxy

# Check Internet Explorer proxy (also used by many apps)
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer
```

If proxy settings are missing or wrong:
1. Push correct settings via GPO (preferred) — confirm with IT admin
2. Manual: Settings → Network → Proxy → set proxy address and port (e.g. `proxy.contoso.com:8080`)
3. For WPAD (auto-detect): ensure DNS has a `wpad` A record and `wpad.dat` is accessible

To test if bypassing the proxy fixes the issue:
```powershell
# Disable proxy temporarily for WinHTTP (PowerShell / .NET apps):
netsh winhttp reset proxy
# Test connectivity, then restore:
netsh winhttp import proxy source=ie
```

---

## Fix: Specific Site / Service Unreachable

```powershell
# Test TCP connectivity on the specific port
Test-NetConnection -ComputerName api.service.com -Port 443

# Trace the route
tracert api.service.com

# Check if Windows Firewall is blocking it
Get-NetFirewallRule | Where-Object {$_.Enabled -eq "True" -and $_.Direction -eq "Outbound" -and $_.Action -eq "Block"}
```

If the service is internal (e.g. SharePoint, file server):
1. Confirm the server is up: `Test-NetConnection fileserver -Port 445`
2. Confirm the user has access (permissions vs. connectivity are different problems)
3. Check if VPN is required to reach the resource (see VPN runbook)

---

## Fix: Wi-Fi Connectivity Issues

```powershell
# View available networks and signal strength
netsh wlan show networks mode=bssid

# Check current connection
netsh wlan show interfaces

# Forget and reconnect to network
netsh wlan delete profile name="CORP-WIFI"
# Reconnect from the system tray
```

If Wi-Fi adapter issues:
```powershell
# Disable and re-enable adapter
Disable-NetAdapter -Name "Wi-Fi" -Confirm:$false
Start-Sleep 3
Enable-NetAdapter -Name "Wi-Fi"

# Update driver
pnputil /scan-devices  # triggers Windows to check for driver updates
```

If multiple users on the same AP have issues → escalate to **Network Engineering** (AP may need reboot or is overloaded).

---

## Fix: NIC Driver / Hardware Reset

```powershell
# Reset TCP/IP stack
netsh int ip reset
netsh winsock reset

# Requires reboot -- warn the user
Restart-Computer -Confirm
```

If physical NIC failure is suspected:
- Try USB-to-Ethernet adapter to confirm
- Log ticket for Field Services for hardware replacement

---

## Escalation Triggers

Escalate to **Network Engineering** if:
- DHCP scope exhausted or DHCP server unreachable
- DNS server unreachable or returning wrong results
- Multiple users on same subnet affected simultaneously
- Switch port / VLAN misconfiguration suspected
- Wireless access point issues

Escalate to **Field Services** if:
- Physical cable or NIC replacement needed
- User is remote and physical hardware access required

---

## Related

- Runbook: VPN Troubleshooting
- Escalation: neteng@company.com (infrastructure), fieldservices@company.com (hardware)
