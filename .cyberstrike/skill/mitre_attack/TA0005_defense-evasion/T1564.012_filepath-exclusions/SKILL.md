---
name: "T1564.012_filepath-exclusions"
description: "Adversaries may attempt to hide their file-based artifacts by writing them to specific folders or file names excluded from antivirus (AV) scanning and other defensive capabilities."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.012
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1564.012"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1564/012"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.001
  - T1564.002
  - T1564.003
  - T1564.004
  - T1564.005
  - T1564.006
  - T1564.007
  - T1564.008
  - T1564.009
  - T1564.010
  - T1564.011
  - T1564.013
  - T1564.014
prerequisites:
  - T1564
severity_boost:
  T1564: "Chain with T1564 for deeper attack path"
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.002: "Chain with T1564.002 for deeper attack path"
---

# T1564.012 File/Path Exclusions

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may attempt to hide their file-based artifacts by writing them to specific folders or file names excluded from antivirus (AV) scanning and other defensive capabilities. AV and other file-based scanners often include exclusions to optimize performance as well as ease installation and legitimate use of applications. These exclusions may be contextual (e.g., scans are only initiated in response to specific triggering events/alerts), but are also often hardcoded strings referencing specific folders and/or files assumed to be trusted and legitimate.

Adversaries may abuse these exclusions to hide their file-based artifacts. For example, rather than tampering with tool settings to add a new exclusion (i.e., Disable or Modify Tools), adversaries may drop their file-based payloads in default or otherwise well-known exclusions. Adversaries may also use Security Software Discovery and other Discovery/Reconnaissance activities to both discover and verify existing exclusions in a victim environment.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if File/Path Exclusions technique is applicable to target environment
- [ ] Check Linux systems for indicators of File/Path Exclusions
- [ ] Check macOS systems for indicators of File/Path Exclusions
- [ ] Check Windows systems for indicators of File/Path Exclusions
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to File/Path Exclusions by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1049 Antivirus/Antimalware
Review and audit file/folder exclusions, and limit scope of exclusions to only what is required where possible.

### M1013 Application Developer Guidance
Application developers should consider limiting the requirements for custom or otherwise difficult to manage file/folder exclusions. Where possible, install applications to trusted system folder paths that are already protected by restricted file and directory permissions.


## Detection

### Detection Strategy for File/Path Exclusions


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| File/Path Exclusions technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Microsoft File Folder Exclusions](https://learn.microsoft.com/en-us/microsoft-365/security/defender-endpoint/configure-contextual-file-folder-exclusions-microsoft-defender-antivirus)
- [Atomic Red Team - T1564.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.012)
- [MITRE ATT&CK - T1564.012](https://attack.mitre.org/techniques/T1564/012)
