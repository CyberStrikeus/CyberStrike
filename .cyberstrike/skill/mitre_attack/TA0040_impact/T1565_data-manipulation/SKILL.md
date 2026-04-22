---
name: "T1565_data-manipulation"
description: "Adversaries may insert, delete, or manipulate data in order to influence external outcomes or hide activity, thus threatening the integrity of the data."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1565
  - impact
  - linux
  - macos
  - windows
technique_id: "T1565"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1565"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  - T1565.001
  - T1565.002
  - T1565.003
prerequisites:
  []
severity_boost:
  T1565.001: "Chain with T1565.001 for deeper attack path"
  T1565.002: "Chain with T1565.002 for deeper attack path"
  T1565.003: "Chain with T1565.003 for deeper attack path"
---

# T1565 Data Manipulation

## High-Level Description

Adversaries may insert, delete, or manipulate data in order to influence external outcomes or hide activity, thus threatening the integrity of the data. By manipulating data, adversaries may attempt to affect a business process, organizational understanding, or decision making.

The type of modification and the impact it will have depends on the target application and process as well as the goals and objectives of the adversary. For complex systems, an adversary would likely need special expertise and possibly access to specialized software related to the system that would typically be gained through a prolonged information gathering campaign in order to have the desired impact.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Data Manipulation technique is applicable to target environment
- [ ] Check Linux systems for indicators of Data Manipulation
- [ ] Check macOS systems for indicators of Data Manipulation
- [ ] Check Windows systems for indicators of Data Manipulation
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data Manipulation by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1565 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1041 Encrypt Sensitive Information
Consider encrypting important information to reduce an adversary’s ability to perform tailored data modifications.

### M1029 Remote Data Storage
Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and manipulate backups.

### M1030 Network Segmentation
Identify critical business and system processes that may be targeted by adversaries and work to isolate and secure those systems against unauthorized access and tampering.

### M1022 Restrict File and Directory Permissions
Ensure least privilege principles are applied to important information resources to reduce exposure to data manipulation risk.


## Detection

### Detection Strategy for Data Manipulation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data Manipulation technique applicable | Low | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Sygnia Elephant Beetle Jan 2022](https://f.hubspotusercontent30.net/hubfs/8776530/Sygnia-%20Elephant%20Beetle_Jan2022.pdf?__hstc=147695848.3e8f1a482c8f8d4531507747318e660b.1680005306711.1680005306711.1680005306711.1&__hssc=147695848.1.1680005306711&__hsfp=3000179024&hsCtaTracking=189ec409-ae2d-4909-8bf1-62dcdd694372%7Cca91d317-8f10-4a38-9f80-367f551ad64d)
- [Atomic Red Team - T1565](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1565)
- [MITRE ATT&CK - T1565](https://attack.mitre.org/techniques/T1565)
