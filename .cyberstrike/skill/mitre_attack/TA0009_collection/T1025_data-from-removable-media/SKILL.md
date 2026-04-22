---
name: "T1025_data-from-removable-media"
description: "Adversaries may search connected removable media on computers they have compromised to find files of interest."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1025
  - collection
  - linux
  - macos
  - windows
technique_id: "T1025"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1025"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1025 Data from Removable Media

## High-Level Description

Adversaries may search connected removable media on computers they have compromised to find files of interest. Sensitive data can be collected from any removable media (optical disk drive, USB memory, etc.) connected to the compromised system prior to Exfiltration. Interactive command shells may be in use, and common functionality within cmd may be used to gather information.

Some adversaries may also use Automated Collection on removable media.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Data from Removable Media technique is applicable to target environment
- [ ] Check Linux systems for indicators of Data from Removable Media
- [ ] Check macOS systems for indicators of Data from Removable Media
- [ ] Check Windows systems for indicators of Data from Removable Media
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Identify Documents on USB and Removable Media via PowerShell

This test simulates an attack where PowerShell is used to detect connected USB or other removable storage devices and gather a list of specific document files
(e.g., .docx, .xls, .txt, .pdf). The command works by first identifying removable drives on the system and then recursively searching through each one for files
matching the targeted extensions. If no removable drives are present, the script will return a message stating that no media is detected. This behavior mimics
how adversaries might scan for sensitive documents on removable devices for exfiltration or analysis.

**Supported Platforms:** windows

```cmd
powershell.exe -c "Get-Volume | Where-Object {$_.DriveType -eq 'Removable'} | ForEach-Object { Get-ChildItem -Path ($_.DriveLetter + ':\*') -Recurse -Include '*.doc*','*.xls*','*.txt','*.pdf' -ErrorAction SilentlyContinue | ForEach-Object {Write-Output $_.FullName} } ; if (-not (Get-Volume | Where-Object {$_.DriveType -eq 'Removable'})) { Write-Output 'No removable media.' }"
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data from Removable Media by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1025 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1057 Data Loss Prevention

Data loss prevention can restrict access to sensitive data and detect sensitive data that is unencrypted.

## Detection

### Detection of Data Access and Collection from Removable Media

## Risk Assessment

| Finding                                        | Severity | Impact     |
| ---------------------------------------------- | -------- | ---------- |
| Data from Removable Media technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1025](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1025)
- [MITRE ATT&CK - T1025](https://attack.mitre.org/techniques/T1025)
