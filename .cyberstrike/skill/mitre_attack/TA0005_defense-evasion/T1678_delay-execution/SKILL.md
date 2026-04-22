---
name: "T1678_delay-execution"
description: "Adversaries may employ various time-based methods to evade detection and analysis."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1678
  - defense-evasion
  - linux
  - macos
  - windows
technique_id: "T1678"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1678"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1678 Delay Execution

## High-Level Description

Adversaries may employ various time-based methods to evade detection and analysis. These techniques often exploit system clocks, delays, or timing mechanisms to obscure malicious activity, blend in with benign activity, and avoid scrutiny. Adversaries can perform this behavior within virtualization/sandbox environments or natively on host systems.

Adversaries may utilize programmatic `sleep` commands or native system scheduling functionality, for example Scheduled Task/Job. Benign commands or other operations may also be used to delay malware execution or ensure prior commands have had time to execute properly. Loops or otherwise needless repetitions of commands, such as `ping`, may be used to delay malware execution and potentially exceed time thresholds of automated analysis environments. Another variation, commonly referred to as API hammering, involves making various calls to Native API functions in order to delay execution (while also potentially overloading analysis environments with junk data).

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Delay Execution technique is applicable to target environment
- [ ] Check Linux systems for indicators of Delay Execution
- [ ] Check macOS systems for indicators of Delay Execution
- [ ] Check Windows systems for indicators of Delay Execution
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Delay Execution by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1678 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Multi-Platform Detection Strategy for T1678 - Delay Execution

## Risk Assessment

| Finding                              | Severity | Impact          |
| ------------------------------------ | -------- | --------------- |
| Delay Execution technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Joe Sec Nymaim](https://www.joesecurity.org/blog/3660886847485093803)
- [Joe Sec Trickbot](https://www.joesecurity.org/blog/498839998833561473)
- [Revil Independence Day](https://news.sophos.com/en-us/2021/07/04/independence-day-revil-uses-supply-chain-exploit-to-attack-hundreds-of-businesses/)
- [Netskope Nitol](https://www.netskope.com/blog/nitol-botnet-makes-resurgence-evasive-sandbox-analysis-technique)
- [Atomic Red Team - T1678](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1678)
- [MITRE ATT&CK - T1678](https://attack.mitre.org/techniques/T1678)
