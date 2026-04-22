---
name: "T1070.009_clear-persistence"
description: "Adversaries may clear artifacts associated with previously established persistence on a host system to remove evidence of their activity."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1070.009
  - defense-evasion
  - esxi
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1070.009"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1070/009"
tech_stack:
  - esxi
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1070
  - T1070.001
  - T1070.002
  - T1070.003
  - T1070.004
  - T1070.005
  - T1070.006
  - T1070.007
  - T1070.008
  - T1070.010
prerequisites:
  - T1070
severity_boost:
  T1070: "Chain with T1070 for deeper attack path"
  T1070.001: "Chain with T1070.001 for deeper attack path"
  T1070.002: "Chain with T1070.002 for deeper attack path"
---

# T1070.009 Clear Persistence

> **Sub-technique of:** T1070

## High-Level Description

Adversaries may clear artifacts associated with previously established persistence on a host system to remove evidence of their activity. This may involve various actions, such as removing services, deleting executables, Modify Registry, Plist File Modification, or other methods of cleanup to prevent defenders from collecting evidence of their persistent presence. Adversaries may also delete accounts previously created to maintain persistence (i.e. Create Account).

In some instances, artifacts of persistence may also be removed once an adversary’s persistence is executed in order to prevent errors with the new instance of the malware.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, Windows, macOS

## What to Check

- [ ] Identify if Clear Persistence technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Clear Persistence
- [ ] Check Linux systems for indicators of Clear Persistence
- [ ] Check Windows systems for indicators of Clear Persistence
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Clear Persistence by examining the target platforms (ESXi, Linux, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1070.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1022 Restrict File and Directory Permissions
Protect generated event files that are stored locally with proper permissions and authentication and limit opportunities for adversaries to increase privileges by preventing Privilege Escalation opportunities.

### M1029 Remote Data Storage
Automatically forward events to a log server or data repository to prevent conditions in which the adversary can locate and manipulate data on the local system. When possible, minimize time delay on event reporting to avoid prolonged storage on the local system.


## Detection

### Detection of Persistence Artifact Removal Across Host Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Clear Persistence technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Cylance Dust Storm](https://s7d2.scene7.com/is/content/cylance/prod/cylance-web/en-us/resources/knowledge-center/resource-library/reports/Op_Dust_Storm_Report.pdf)
- [Talos - Cisco Attack 2022](https://blog.talosintelligence.com/recent-cyber-attack/)
- [NCC Group Team9 June 2020](https://research.nccgroup.com/2020/06/02/in-depth-analysis-of-the-new-team9-malware-family/)
- [Atomic Red Team - T1070.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1070.009)
- [MITRE ATT&CK - T1070.009](https://attack.mitre.org/techniques/T1070/009)
