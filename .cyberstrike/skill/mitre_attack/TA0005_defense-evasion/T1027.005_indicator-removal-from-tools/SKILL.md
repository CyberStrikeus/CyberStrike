---
name: "T1027.005_indicator-removal-from-tools"
description: "Adversaries may remove indicators from tools if they believe their malicious tool was detected, quarantined, or otherwise curtailed."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.005
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/005"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1027
  - T1027.001
  - T1027.002
  - T1027.003
  - T1027.004
  - T1027.006
  - T1027.007
  - T1027.008
  - T1027.009
  - T1027.010
  - T1027.011
  - T1027.012
  - T1027.013
  - T1027.014
  - T1027.015
  - T1027.016
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.005 Indicator Removal from Tools

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may remove indicators from tools if they believe their malicious tool was detected, quarantined, or otherwise curtailed. They can modify the tool by removing the indicator and using the updated version that is no longer detected by the target's defensive systems or subsequent targets that may use similar systems.

A good example of this is when malware is detected with a file signature and quarantined by anti-virus software. An adversary who can determine that the malware was quarantined because of its file signature may modify the file to explicitly avoid that signature, and then re-use the malware.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Indicator Removal from Tools technique is applicable to target environment
- [ ] Check Linux systems for indicators of Indicator Removal from Tools
- [ ] Check macOS systems for indicators of Indicator Removal from Tools
- [ ] Check Windows systems for indicators of Indicator Removal from Tools
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Indicator Removal from Tools by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Indicator Removal from Tools - Post-AV Evasion Modification

## Risk Assessment

| Finding                                           | Severity | Impact          |
| ------------------------------------------------- | -------- | --------------- |
| Indicator Removal from Tools technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Atomic Red Team - T1027.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.005)
- [MITRE ATT&CK - T1027.005](https://attack.mitre.org/techniques/T1027/005)
