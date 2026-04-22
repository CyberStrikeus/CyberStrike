---
name: "T1006_direct-volume-access"
description: "Adversaries may directly access a volume to bypass file access controls and file system monitoring."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1006
  - defense-evasion
  - network-devices
  - windows
technique_id: "T1006"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1006"
tech_stack:
  - network devices
  - windows
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1006 Direct Volume Access

## High-Level Description

Adversaries may directly access a volume to bypass file access controls and file system monitoring. Windows allows programs to have direct access to logical volumes. Programs with direct access may read and write files directly from the drive by analyzing file system data structures. This technique may bypass Windows file access controls as well as file system monitoring tools. 

Utilities, such as `NinjaCopy`, exist to perform these actions in PowerShell. Adversaries may also use built-in or third-party utilities (such as `vssadmin`, `wbadmin`, and esentutl) to create shadow copies or backups of data from system volumes.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Network Devices, Windows

## What to Check

- [ ] Identify if Direct Volume Access technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Direct Volume Access
- [ ] Check Windows systems for indicators of Direct Volume Access
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Read volume boot sector via DOS device path (PowerShell)

This test uses PowerShell to open a handle on the drive volume via the `\\.\` [DOS device path specifier](https://docs.microsoft.com/en-us/dotnet/standard/io/file-path-formats#dos-device-paths) and perform direct access read of the first few bytes of the volume.
On success, a hex dump of the first 11 bytes of the volume is displayed.

For a NTFS volume, it should correspond to the following sequence ([NTFS partition boot sector](https://en.wikipedia.org/wiki/NTFS#Partition_Boot_Sector_(VBR))):
```
           00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F

00000000   EB 52 90 4E 54 46 53 20 20 20 20                 ëR?NTFS
```

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$buffer = New-Object byte[] 11
$handle = New-Object IO.FileStream "\\.\#{volume}", 'Open', 'Read', 'ReadWrite'
$handle.Read($buffer, 0, $buffer.Length)
$handle.Close()
Format-Hex -InputObject $buffer
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Direct Volume Access by examining the target platforms (Network Devices, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
Some endpoint security solutions can be configured to block some types of behaviors related to efforts by an adversary to create backups, such as command execution or preventing API calls to backup related services.

### M1018 User Account Management
Ensure only accounts required to configure and manage backups have the privileges to do so. Monitor these accounts for unauthorized backup activity.


## Detection

### Detection of Direct Volume Access for File System Evasion


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Direct Volume Access technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Github PowerSploit Ninjacopy](https://github.com/PowerShellMafia/PowerSploit/blob/master/Exfiltration/Invoke-NinjaCopy.ps1)
- [Hakobyan 2009](http://www.codeproject.com/Articles/32169/FDump-Dumping-File-Sectors-Directly-from-Disk-usin)
- [LOLBAS Esentutl](https://lolbas-project.github.io/lolbas/Binaries/Esentutl/)
- [Atomic Red Team - T1006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1006)
- [MITRE ATT&CK - T1006](https://attack.mitre.org/techniques/T1006)
