# VPN Troubleshooting Runbook

## Scope
Covers Cisco AnyConnect, GlobalProtect (Palo Alto), and Windows Built-In VPN (IKEv2/SSTP).
For split-tunnel and full-tunnel configurations.

## Common Symptoms
- "Unable to connect" or "Connection attempt failed"
- VPN connects but no internet or no internal resources reachable
- VPN connects but disconnects immediately or after a few minutes
- "Certificate not trusted" or "Authentication failed"
- "Untrusted network" warnings
- VPN works from home but not from coffee shop / hotel / cellular hotspot

---

## Diagnostic Steps — Run First

Ask the user to provide:
1. Error message text (exact wording matters)
2. VPN client name and version (`Help → About` or `Show Info` in client)
3. Operating system and version
4. Network they are on (home broadband, mobile hotspot, corporate office, hotel)
5. When it last worked

---

## Fix: "Authentication Failed" / Wrong Credentials

1. Confirm user is entering their **domain credentials** (not local PC password)
   - Username format is usually `DOMAIN\jsmith` or `jsmith@contoso.com`
2. If using MFA/push: confirm they approved the push notification (check Authenticator app)
3. If account locked out: resolve via Password Reset runbook first
4. If certificate-based auth: verify personal cert is present in Certificates → Personal store

---

## Fix: "Server Certificate Not Trusted"

**Cisco AnyConnect:**
1. Open AnyConnect → Preferences → check "Block connections to untrusted servers" — if checked, the CA cert is missing
2. Import the corporate CA cert: `certmgr.msc` → Trusted Root Certification Authorities → Import

**GlobalProtect:**
1. Error usually reads "The SSL certificate of the gateway is not trusted"
2. Export the root CA from a working machine and import on affected machine:
   ```powershell
   certutil -addstore "Root" corporate-ca.crt
   ```
3. Alternatively: push the cert via GPO (permanent fix for managed devices)

---

## Fix: "VPN Connects but No Resources Reachable"

### Check 1 — DNS not pointing to internal DNS
```powershell
# Run while VPN is connected:
nslookup intranet.contoso.com
# Expected: resolves to 10.x.x.x
# If not: VPN split-tunnel DNS is misconfigured
```

If DNS is wrong:
- Full-tunnel: disconnect and reconnect; check VPN adapter is the default gateway
- Split-tunnel: IT must update the DNS suffix / split-tunnel DNS config

### Check 2 — Routing table
```powershell
route print
# VPN adapter should have routes for 10.0.0.0/8 or your internal subnets
```

If no internal routes: VPN tunnel is up but split-tunnel routes are missing → escalate to **Network Engineering**.

### Check 3 — Firewall blocking
```powershell
Test-NetConnection -ComputerName fileserver.contoso.com -Port 445
```
If blocked: check Windows Firewall is not blocking the VPN adapter's network profile.

---

## Fix: Disconnects Immediately After Connecting

1. **Check for duplicate VPN clients** — uninstall any old AnyConnect/GlobalProtect versions
2. **Check for conflicting VPN adapters:**
   ```powershell
   Get-NetAdapter | Where-Object {$_.InterfaceDescription -like "*VPN*"}
   ```
   Remove orphaned adapters via Device Manager (View → Show hidden devices)
3. **MTU issue** (common on cellular/hotel networks):
   ```powershell
   # Temporarily lower MTU on VPN adapter:
   netsh interface ipv4 set subinterface "VPN" mtu=1300 store=persistent
   ```
4. **Proxy conflicts:** If the machine uses a proxy, ensure VPN bypasses it (`DIRECT` for internal hosts)

---

## Fix: VPN Works From Home But Not Hotel / Hotspot

Likely cause: **ISP or captive portal blocking VPN ports**.

| Protocol | Port | Workaround |
|---|---|---|
| IPsec/IKEv2 | UDP 500/4500 | Try SSL/HTTPS-based VPN profile |
| AnyConnect SSL | TCP 443 | Usually works; check if hotel blocks HTTPS too |
| GlobalProtect | TCP 443 + UDP 4501 | Switch to "Always-on" mode for cellular |

Action:
1. Try the alternative VPN gateway (many orgs have an SSL-only gateway for restricted networks)
2. Ask the user to try mobile hotspot — if that works, the hotel/ISP is blocking the port
3. Escalate to **Network Engineering** to configure a TCP 443 fallback gateway if not already present

---

## Fix: "Untrusted Network" (GlobalProtect)

GlobalProtect shows this when it detects the device is not on a corporate network and "Connect Before Logon" / "Always-On" is enforced.

1. Verify the user is trying to connect from outside corporate network — this is expected
2. If showing on a known-good connection: HIP check (Host Information Profile) may be failing
   - Check that antivirus is running and up-to-date (GP's HIP check verifies this)
   - Check that disk encryption is enabled (BitLocker)
3. If HIP check is failing on a compliant machine: escalate to **Network Engineering** for HIP exception

---

## Cisco AnyConnect — Repair / Reinstall

```powershell
# Uninstall cleanly (run as admin):
msiexec /x {AnyConnect-GUID} /quiet

# Remove leftover adapter:
devmgmt.msc → Network adapters → Cisco AnyConnect (hidden) → Uninstall

# Reinstall from internal software portal or:
# \\fileserver\software\anyconnect\anyconnect-win-<version>-predeploy-k9.msi
```

---

## GlobalProtect — Collect Logs for Escalation

1. Open GlobalProtect → top-right ⚙ → Troubleshooting → Collect Logs
2. Saves a `PanGPS.log` zip to the desktop
3. Attach to ticket before escalating to Network Engineering

---

## Escalation Triggers

Escalate to **Network Engineering** if:
- VPN connects but routing/DNS is wrong (server-side config issue)
- Port is blocked network-wide (not just one user)
- Certificate has expired on the VPN gateway
- More than 3 users reporting the same issue simultaneously

Escalate to **Security** if:
- VPN credentials appear to have been used from an unexpected location
- User reports they cannot connect but no failed password attempts appear in logs

---

## Related

- Policy: Remote Access Policy
- Escalation matrix: neteng@company.com, security@company.com
