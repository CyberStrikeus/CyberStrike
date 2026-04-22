---
name: "T1565.002_transmitted-data-manipulation"
description: "Adversaries may alter data en route to storage or other systems in order to manipulate external outcomes or hide activity, thus threatening the integrity of the data."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1565.002
  - impact
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1565.002"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1565/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  - T1565
  - T1565.001
  - T1565.003
prerequisites:
  - T1565
severity_boost:
  T1565: "Chain with T1565 for deeper attack path"
  T1565.001: "Chain with T1565.001 for deeper attack path"
  T1565.003: "Chain with T1565.003 for deeper attack path"
---

# T1565.002 Transmitted Data Manipulation

> **Sub-technique of:** T1565

## High-Level Description

Adversaries may alter data en route to storage or other systems in order to manipulate external outcomes or hide activity, thus threatening the integrity of the data. By manipulating transmitted data, adversaries may attempt to affect a business process, organizational understanding, and decision making.

Manipulation may be possible over a network connection or between system processes where there is an opportunity deploy a tool that will intercept and change information. The type of modification and the impact it will have depends on the target transmission mechanism as well as the goals and objectives of the adversary. For complex systems, an adversary would likely need special expertise and possibly access to specialized software related to the system that would typically be gained through a prolonged information gathering campaign in order to have the desired impact.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Transmitted Data Manipulation technique is applicable to target environment
- [ ] Check Linux systems for indicators of Transmitted Data Manipulation
- [ ] Check macOS systems for indicators of Transmitted Data Manipulation
- [ ] Check Windows systems for indicators of Transmitted Data Manipulation
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Transmitted Data Manipulation by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1565.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1041 Encrypt Sensitive Information

Encrypt all important data flows to reduce the impact of tailored modifications on data in transit.

## Detection

### Detection Strategy of Transmitted Data Manipulation

## Risk Assessment

| Finding                                            | Severity | Impact |
| -------------------------------------------------- | -------- | ------ |
| Transmitted Data Manipulation technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [DOJ Lazarus Sony 2018](https://www.justice.gov/opa/press-release/file/1092091/download)
- [FireEye APT38 Oct 2018](https://www.mandiant.com/sites/default/files/2021-09/rpt-apt38-2018-web_v5-1.pdf)
- [Atomic Red Team - T1565.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1565.002)
- [MITRE ATT&CK - T1565.002](https://attack.mitre.org/techniques/T1565/002)
