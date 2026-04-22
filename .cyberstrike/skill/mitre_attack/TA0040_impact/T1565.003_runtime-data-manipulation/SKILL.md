---
name: "T1565.003_runtime-data-manipulation"
description: "Adversaries may modify systems in order to manipulate the data as it is accessed and displayed to an end user, thus threatening the integrity of the data."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1565.003
  - impact
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1565.003"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1565/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  - T1565
  - T1565.001
  - T1565.002
prerequisites:
  - T1565
severity_boost:
  T1565: "Chain with T1565 for deeper attack path"
  T1565.001: "Chain with T1565.001 for deeper attack path"
  T1565.002: "Chain with T1565.002 for deeper attack path"
---

# T1565.003 Runtime Data Manipulation

> **Sub-technique of:** T1565

## High-Level Description

Adversaries may modify systems in order to manipulate the data as it is accessed and displayed to an end user, thus threatening the integrity of the data. By manipulating runtime data, adversaries may attempt to affect a business process, organizational understanding, and decision making.

Adversaries may alter application binaries used to display data in order to cause runtime manipulations. Adversaries may also conduct Change Default File Association and Masquerading to cause a similar effect. The type of modification and the impact it will have depends on the target application and process as well as the goals and objectives of the adversary. For complex systems, an adversary would likely need special expertise and possibly access to specialized software related to the system that would typically be gained through a prolonged information gathering campaign in order to have the desired impact.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Runtime Data Manipulation technique is applicable to target environment
- [ ] Check Linux systems for indicators of Runtime Data Manipulation
- [ ] Check macOS systems for indicators of Runtime Data Manipulation
- [ ] Check Windows systems for indicators of Runtime Data Manipulation
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Runtime Data Manipulation by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1565.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1030 Network Segmentation

Identify critical business and system processes that may be targeted by adversaries and work to isolate and secure those systems against unauthorized access and tampering.

### M1022 Restrict File and Directory Permissions

Prevent critical business and system processes from being replaced, overwritten, or reconfigured to load potentially malicious code.

## Detection

### Detection Strategy for Runtime Data Manipulation.

## Risk Assessment

| Finding                                        | Severity | Impact |
| ---------------------------------------------- | -------- | ------ |
| Runtime Data Manipulation technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [DOJ Lazarus Sony 2018](https://www.justice.gov/opa/press-release/file/1092091/download)
- [FireEye APT38 Oct 2018](https://www.mandiant.com/sites/default/files/2021-09/rpt-apt38-2018-web_v5-1.pdf)
- [Atomic Red Team - T1565.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1565.003)
- [MITRE ATT&CK - T1565.003](https://attack.mitre.org/techniques/T1565/003)
