---
name: "T1070_indicator-removal"
description: "Adversaries may delete or modify artifacts generated within systems to remove evidence of their presence or hinder defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1070
  - defense-evasion
  - containers
  - esxi
  - linux
  - macos
  - network-devices
  - office-suite
  - windows
technique_id: "T1070"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Containers
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Office Suite
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1070"
tech_stack:
  - containers
  - esxi
  - linux
  - macos
  - network devices
  - office
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1070.001
  - T1070.002
  - T1070.003
  - T1070.004
  - T1070.005
  - T1070.006
  - T1070.007
  - T1070.008
  - T1070.009
  - T1070.010
prerequisites:
  []
severity_boost:
  T1070.001: "Chain with T1070.001 for deeper attack path"
  T1070.002: "Chain with T1070.002 for deeper attack path"
  T1070.003: "Chain with T1070.003 for deeper attack path"
---

# T1070 Indicator Removal

## High-Level Description

Adversaries may delete or modify artifacts generated within systems to remove evidence of their presence or hinder defenses. Various artifacts may be created by an adversary or something that can be attributed to an adversary’s actions. Typically these artifacts are used as defensive indicators related to monitored events, such as strings from downloaded files, logs that are generated from user actions, and other data analyzed by defenders. Location, format, and type of artifact (such as command or login history) are often specific to each platform.

Removal of these indicators may interfere with event collection, reporting, or other processes used to detect intrusion activity. This may compromise the integrity of security solutions by causing notable events to go unreported. This activity may also impede forensic analysis and incident response, due to lack of sufficient data to determine what occurred.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Containers, ESXi, Linux, macOS, Network Devices, Office Suite, Windows

## What to Check

- [ ] Identify if Indicator Removal technique is applicable to target environment
- [ ] Check Containers systems for indicators of Indicator Removal
- [ ] Check ESXi systems for indicators of Indicator Removal
- [ ] Check Linux systems for indicators of Indicator Removal
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Indicator Removal using FSUtil

Manages the update sequence number (USN) change journal, which provides a persistent log of all changes made to files on the volume. Upon execution, no output
will be displayed. More information about fsutil can be found at https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/fsutil-usn

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
fsutil usn deletejournal /D C:
```

### Atomic Test 2: Indicator Manipulation using FSUtil

Finds a file by user name (if Disk Quotas are enabled), queries allocated ranges for a file, sets a file's short name, sets a file's valid data length, sets zero data for a file, or creates a new file. Upon execution, no output
will be displayed. More information about fsutil can be found at https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/fsutil-file
- https://tria.ge/230601-x8x6bsgb24/behavioral2

**Supported Platforms:** windows

```powershell
if (-not (Test-Path "#{file_to_manipulate}")) { New-Item "#{file_to_manipulate}" -Force } 
echo "1234567890" > "#{file_to_manipulate}"
fsutil  file setZeroData offset=0 length=#{file_data_length} "#{file_to_manipulate}"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Indicator Removal by examining the target platforms (Containers, ESXi, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1070 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1041 Encrypt Sensitive Information
Obfuscate/encrypt event files locally and in transit to avoid giving feedback to an adversary.

### M1029 Remote Data Storage
Automatically forward events to a log server or data repository to prevent conditions in which the adversary can locate and manipulate data on the local system. When possible, minimize time delay on event reporting to avoid prolonged storage on the local system.

### M1022 Restrict File and Directory Permissions
Protect generated event files that are stored locally with proper permissions and authentication and limit opportunities for adversaries to increase privileges by preventing Privilege Escalation opportunities.


## Detection

### Behavioral Detection of Indicator Removal Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Indicator Removal technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Atomic Red Team - T1070](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1070)
- [MITRE ATT&CK - T1070](https://attack.mitre.org/techniques/T1070)
