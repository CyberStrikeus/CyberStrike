---
name: "T1127.003_jamplus"
description: "Adversaries may use `JamPlus` to proxy the execution of a malicious script."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1127.003
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1127.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1127/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1127
  - T1127.001
  - T1127.002
prerequisites:
  - T1127
severity_boost:
  T1127: "Chain with T1127 for deeper attack path"
  T1127.001: "Chain with T1127.001 for deeper attack path"
  T1127.002: "Chain with T1127.002 for deeper attack path"
---

# T1127.003 JamPlus

> **Sub-technique of:** T1127

## High-Level Description

Adversaries may use `JamPlus` to proxy the execution of a malicious script. `JamPlus` is a build utility tool for code and data build systems. It works with several popular compilers and can be used for generating workspaces in code editors such as Visual Studio.

Adversaries may abuse the `JamPlus` build utility to execute malicious scripts via a `.jam` file, which describes the build process and required dependencies. Because the malicious script is executed from a reputable developer tool, it may subvert application control security systems such as Smart App Control.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if JamPlus technique is applicable to target environment
- [ ] Check Windows systems for indicators of JamPlus
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to JamPlus by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1127.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention
Consider blocking or restricting JamPlus if not required.

### M1042 Disable or Remove Feature or Program
JamPlus may not be necessary within a given environment and should be removed if not used.


## Detection

### Behavior-chain detection strategy for T1127.003 Trusted Developer Utilities Proxy Execution: JamPlus (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| JamPlus technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Cyble](https://cyble.com/blog/reputation-hijacking-with-jamplus-a-maneuver-to-bypass-smart-app-control-sac/)
- [Elastic Security Labs](https://www.elastic.co/security-labs/dismantling-smart-app-control)
- [JamPlus manual](https://jamplus.github.io/jamplus/quick_start.html)
- [Atomic Red Team - T1127.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1127.003)
- [MITRE ATT&CK - T1127.003](https://attack.mitre.org/techniques/T1127/003)
