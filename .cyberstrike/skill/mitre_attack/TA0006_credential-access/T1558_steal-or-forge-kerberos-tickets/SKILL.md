---
name: "T1558_steal-or-forge-kerberos-tickets"
description: "Adversaries may attempt to subvert Kerberos authentication by stealing or forging Kerberos tickets to enable Pass the Ticket."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1558
  - credential-access
  - windows
  - linux
  - macos
technique_id: "T1558"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1558"
tech_stack:
  - windows
  - linux
  - macos
cwe_ids:
  - CWE-522
chains_with:
  - T1558.001
  - T1558.002
  - T1558.003
  - T1558.004
  - T1558.005
prerequisites:
  []
severity_boost:
  T1558.001: "Chain with T1558.001 for deeper attack path"
  T1558.002: "Chain with T1558.002 for deeper attack path"
  T1558.003: "Chain with T1558.003 for deeper attack path"
---

# T1558 Steal or Forge Kerberos Tickets

## High-Level Description

Adversaries may attempt to subvert Kerberos authentication by stealing or forging Kerberos tickets to enable Pass the Ticket. Kerberos is an authentication protocol widely used in modern Windows domain environments. In Kerberos environments, referred to as “realms”, there are three basic participants: client, service, and Key Distribution Center (KDC). Clients request access to a service and through the exchange of Kerberos tickets, originating from KDC, they are granted access after having successfully authenticated. The KDC is responsible for both authentication and ticket granting. Adversaries may attempt to abuse Kerberos by stealing tickets or forging tickets to enable unauthorized access.

On Windows, the built-in <code>klist</code> utility can be used to list and analyze cached Kerberos tickets.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows, Linux, macOS

## What to Check

- [ ] Identify if Steal or Forge Kerberos Tickets technique is applicable to target environment
- [ ] Check Windows systems for indicators of Steal or Forge Kerberos Tickets
- [ ] Check Linux systems for indicators of Steal or Forge Kerberos Tickets
- [ ] Check macOS systems for indicators of Steal or Forge Kerberos Tickets
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Steal or Forge Kerberos Tickets by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1558 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1015 Active Directory Configuration
For containing the impact of a previously generated golden ticket, reset the built-in KRBTGT account password twice, which will invalidate any existing golden tickets that have been created with the KRBTGT hash and other Kerberos tickets derived from it. For each domain, change the KRBTGT account password once, force replication, and then change the password a second time. Consider rotating the KRBTGT account password every 180 days.

### M1043 Credential Access Protection
On Linux systems, protect resources with Security Enhanced Linux (SELinux) by defining entry points, process types, and file labels.

### M1041 Encrypt Sensitive Information
Enable AES Kerberos encryption (or another stronger encryption algorithm), rather than RC4, where possible.

### M1027 Password Policies
Ensure strong password length (ideally 25+ characters) and complexity for service accounts and that these passwords periodically expire. Also consider using Group Managed Service Accounts or another third party product such as password vaulting.

### M1047 Audit
Perform audits or scans of systems, permissions, insecure software, insecure configurations, etc. to identify potential weaknesses.

### M1026 Privileged Account Management
Limit domain admin account permissions to domain controllers and limited servers. Delegate other admin functions to separate accounts.

Limit service accounts to minimal required privileges, including membership in privileged groups such as Domain Administrators.


## Detection

### Detect Kerberos Ticket Theft or Forgery (T1558)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Steal or Forge Kerberos Tickets technique applicable | Low | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [CERT-EU Golden Ticket Protection](https://cert.europa.eu/static/WhitePapers/UPDATED%20-%20CERT-EU_Security_Whitepaper_2014-007_Kerberos_Golden_Ticket_Protection_v1_4.pdf)
- [Microsoft Detecting Kerberoasting Feb 2018](https://blogs.technet.microsoft.com/motiba/2018/02/23/detecting-kerberoasting-activity-using-azure-security-center/)
- [Medium Detecting Attempts to Steal Passwords from Memory](https://medium.com/threatpunter/detecting-attempts-to-steal-passwords-from-memory-558f16dce4ea)
- [Stealthbits Detect PtT 2019](https://blog.stealthbits.com/detect-pass-the-ticket-attacks)
- [AdSecurity Cracking Kerberos Dec 2015](https://adsecurity.org/?p=2293)
- [ADSecurity Detecting Forged Tickets](https://adsecurity.org/?p=1515)
- [Microsoft Kerberos Golden Ticket](https://gallery.technet.microsoft.com/scriptcenter/Kerberos-Golden-Ticket-b4814285)
- [Microsoft Klist](https://docs.microsoft.com/windows-server/administration/windows-commands/klist)
- [ADSecurity Kerberos Ring Decoder](https://adsecurity.org/?p=227)
- [Atomic Red Team - T1558](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1558)
- [MITRE ATT&CK - T1558](https://attack.mitre.org/techniques/T1558)
