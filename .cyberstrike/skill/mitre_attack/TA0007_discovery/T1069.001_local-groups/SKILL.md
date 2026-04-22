---
name: "T1069.001_local-groups"
description: "Adversaries may attempt to find local system groups and permission settings."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1069.001
  - discovery
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1069.001"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1069/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1069
  - T1069.002
  - T1069.003
prerequisites:
  - T1069
severity_boost:
  T1069: "Chain with T1069 for deeper attack path"
  T1069.002: "Chain with T1069.002 for deeper attack path"
  T1069.003: "Chain with T1069.003 for deeper attack path"
---

# T1069.001 Local Groups

> **Sub-technique of:** T1069

## High-Level Description

Adversaries may attempt to find local system groups and permission settings. The knowledge of local system permission groups can help adversaries determine which groups exist and which users belong to a particular group. Adversaries may use this information to determine which users have elevated permissions, such as the users found within the local administrators group.

Commands such as <code>net localgroup</code> of the Net utility, <code>dscl . -list /Groups</code> on macOS, and <code>groups</code> on Linux can list local groups.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Local Groups technique is applicable to target environment
- [ ] Check Linux systems for indicators of Local Groups
- [ ] Check macOS systems for indicators of Local Groups
- [ ] Check Windows systems for indicators of Local Groups
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Permission Groups Discovery (Local)

Permission Groups Discovery

**Supported Platforms:** linux, macos

```bash
if [ -x "$(command -v dscacheutil)" ]; then dscacheutil -q group; else echo "dscacheutil is missing from the machine. skipping..."; fi;
if [ -x "$(command -v dscl)" ]; then dscl . -list /Groups; else echo "dscl is missing from the machine. skipping..."; fi;
if [ -x "$(command -v groups)" ]; then groups; else echo "groups is missing from the machine. skipping..."; fi;
if [ -x "$(command -v id)" ]; then id; else echo "id is missing from the machine. skipping..."; fi;
if [ -x "$(command -v getent)" ]; then getent group; else echo "getent is missing from the machine. skipping..."; fi;
cat /etc/group
```

### Atomic Test 2: Basic Permission Groups Discovery Windows (Local)

Basic Permission Groups Discovery for Windows. This test will display some errors if run on a computer not connected to a domain. Upon execution, domain
information will be displayed.

**Supported Platforms:** windows

```cmd
net localgroup
net localgroup "Administrators"
```

### Atomic Test 3: Permission Groups Discovery PowerShell (Local)

Permission Groups Discovery utilizing PowerShell. This test will display some errors if run on a computer not connected to a domain. Upon execution, domain
information will be displayed.

**Supported Platforms:** windows

```powershell
get-localgroup
Get-LocalGroupMember -Name "Administrators"
```

### Atomic Test 4: SharpHound3 - LocalAdmin

This module runs the Windows executable of SharpHound in order to remotely list members of the local Administrators group (SAMR)

**Supported Platforms:** windows

```powershell
New-Item -Path "#{output_path}" -ItemType Directory > $null
& "#{sharphound_path}" -d "#{domain}" --CollectionMethod LocalAdmin --NoSaveCache --OutputDirectory "#{output_path}"
```

**Dependencies:**
- SharpHound binary must exist on disk and at specified location (#{sharphound_path}).
And the computer must be domain joined (implicit authentication).

### Atomic Test 5: Wmic Group Discovery

Utilizing wmic.exe to enumerate groups on the local system. Upon execution, information will be displayed of local groups on system.

**Supported Platforms:** windows

```cmd
wmic group get name
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Local Groups by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1069.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Local Group Enumeration Across OS Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Local Groups technique applicable | Low | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Atomic Red Team - T1069.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1069.001)
- [MITRE ATT&CK - T1069.001](https://attack.mitre.org/techniques/T1069/001)
