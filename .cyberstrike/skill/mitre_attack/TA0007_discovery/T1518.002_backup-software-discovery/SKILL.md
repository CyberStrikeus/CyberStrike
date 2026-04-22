---
name: "T1518.002_backup-software-discovery"
description: "Adversaries may attempt to get a listing of backup software or configurations that are installed on a system."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1518.002
  - discovery
  - windows
  - macos
  - linux
  - sub-technique
technique_id: "T1518.002"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1518/002"
tech_stack:
  - windows
  - macos
  - linux
cwe_ids:
  - CWE-200
chains_with:
  - T1518
  - T1518.001
prerequisites:
  - T1518
severity_boost:
  T1518: "Chain with T1518 for deeper attack path"
  T1518.001: "Chain with T1518.001 for deeper attack path"
---

# T1518.002 Backup Software Discovery

> **Sub-technique of:** T1518

## High-Level Description

Adversaries may attempt to get a listing of backup software or configurations that are installed on a system. Adversaries may use this information to shape follow-on behaviors, such as Data Destruction, Inhibit System Recovery, or Data Encrypted for Impact. 

Commands that can be used to obtain security software information are netsh, `reg query` with Reg, `dir` with cmd, and Tasklist, but other indicators of discovery behavior may be more specific to the type of software or security system the adversary is looking for, such as Veeam, Acronis, Dropbox, or Paragon.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Windows, macOS, Linux

## What to Check

- [ ] Identify if Backup Software Discovery technique is applicable to target environment
- [ ] Check Windows systems for indicators of Backup Software Discovery
- [ ] Check macOS systems for indicators of Backup Software Discovery
- [ ] Check Linux systems for indicators of Backup Software Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Backup Software Discovery by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1518.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Backup Software Discovery via CLI, Registry, and Process Inspection (T1518.002)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Backup Software Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Symantec Play Ransomware 2023](https://www.security.com/threat-intelligence/play-ransomware-volume-shadow-copy)
- [Atomic Red Team - T1518.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1518.002)
- [MITRE ATT&CK - T1518.002](https://attack.mitre.org/techniques/T1518/002)
