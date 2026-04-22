---
name: "T1003.003_ntds"
description: "Adversaries may attempt to access or create a copy of the Active Directory domain database in order to steal credential information, as well as obtain other information about domain members such as..."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003.003
  - credential-access
  - windows
  - sub-technique
technique_id: "T1003.003"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1003/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1003
  - T1003.001
  - T1003.002
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
  T1003.002: "Chain with T1003.002 for deeper attack path"
---

# T1003.003 NTDS

> **Sub-technique of:** T1003

## High-Level Description

Adversaries may attempt to access or create a copy of the Active Directory domain database in order to steal credential information, as well as obtain other information about domain members such as devices, users, and access rights. By default, the NTDS file (NTDS.dit) is located in <code>%SystemRoot%\NTDS\Ntds.dit</code> of a domain controller.

In addition to looking for NTDS files on active Domain Controllers, adversaries may search for backups that contain the same or similar information.

The following tools and techniques can be used to enumerate the NTDS file and the contents of the entire Active Directory hashes.

* Volume Shadow Copy
* secretsdump.py
* Using the in-built Windows tool, ntdsutil.exe
* Invoke-NinjaCopy

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if NTDS technique is applicable to target environment
- [ ] Check Windows systems for indicators of NTDS
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create Volume Shadow Copy with vssadmin

This test is intended to be run on a domain Controller.

The Active Directory database NTDS.dit may be dumped by copying it from a Volume Shadow Copy.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
vssadmin.exe create shadow /for=#{drive_letter}
```

**Dependencies:**
- Target must be a Domain Controller

### Atomic Test 2: Copy NTDS.dit from Volume Shadow Copy

This test is intended to be run on a domain Controller.

The Active Directory database NTDS.dit may be dumped by copying it from a Volume Shadow Copy.

This test requires steps taken in the test "Create Volume Shadow Copy with vssadmin".
A successful test also requires the export of the SYSTEM Registry hive.
This test must be executed on a Windows Domain Controller.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
copy #{vsc_name}\Windows\NTDS\NTDS.dit #{extract_path}\ntds.dit
copy #{vsc_name}\Windows\System32\config\SYSTEM #{extract_path}\VSC_SYSTEM_HIVE
reg save HKLM\SYSTEM #{extract_path}\SYSTEM_HIVE
```

**Dependencies:**
- Target must be a Domain Controller
- Volume shadow copy must exist
- Extract path must exist

### Atomic Test 3: Dump Active Directory Database with NTDSUtil

This test is intended to be run on a domain Controller.

The Active Directory database NTDS.dit may be dumped using NTDSUtil for offline credential theft attacks. This capability
uses the "IFM" or "Install From Media" backup functionality that allows Active Directory restoration or installation of
subsequent domain controllers without the need of network-based replication.

Upon successful completion, you will find a copy of the ntds.dit file in the C:\Windows\Temp directory.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
mkdir #{output_folder}
ntdsutil "ac i ntds" "ifm" "create full #{output_folder}" q q
```

**Dependencies:**
- Target must be a Domain Controller

### Atomic Test 4: Create Volume Shadow Copy with WMI

This test is intended to be run on a domain Controller.

The Active Directory database NTDS.dit may be dumped by copying it from a Volume Shadow Copy.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
wmic shadowcopy call create Volume=#{drive_letter}
```

**Dependencies:**
- Target must be a Domain Controller

### Atomic Test 5: Create Volume Shadow Copy remotely with WMI

This test is intended to be run from a remote workstation with domain admin context.
The Active Directory database NTDS.dit may be dumped by copying it from a Volume Shadow Copy.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
wmic /node:"#{target_host}" shadowcopy call create Volume=#{drive_letter}
```

**Dependencies:**
- Target must be a reachable Domain Controller, and current context must be domain admin


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to NTDS by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1003.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies
Ensure that local administrator accounts have complex, unique passwords across all systems on the network.

### M1026 Privileged Account Management
Do not put user or admin domain accounts in the local administrator groups across systems unless they are tightly controlled, as this is often equivalent to having a local administrator account with the same password on all systems. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

### M1017 User Training
Limit credential overlap across accounts and systems by training users and administrators not to use the same password for multiple accounts.

### M1041 Encrypt Sensitive Information
Ensure Domain Controller backups are properly secured.


## Detection

### Detection of NTDS.dit Credential Dumping from Domain Controllers


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| NTDS technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Metcalf 2015](http://adsecurity.org/?p=1275)
- [Wikipedia Active Directory](https://en.wikipedia.org/wiki/Active_Directory)
- [Atomic Red Team - T1003.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003.003)
- [MITRE ATT&CK - T1003.003](https://attack.mitre.org/techniques/T1003/003)
