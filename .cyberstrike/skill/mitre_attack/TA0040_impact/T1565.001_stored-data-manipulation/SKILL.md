---
name: "T1565.001_stored-data-manipulation"
description: "Adversaries may insert, delete, or manipulate data at rest in order to influence external outcomes or hide activity, thus threatening the integrity of the data."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1565.001
  - impact
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1565.001"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1565/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  - T1565
  - T1565.002
  - T1565.003
prerequisites:
  - T1565
severity_boost:
  T1565: "Chain with T1565 for deeper attack path"
  T1565.002: "Chain with T1565.002 for deeper attack path"
  T1565.003: "Chain with T1565.003 for deeper attack path"
---

# T1565.001 Stored Data Manipulation

> **Sub-technique of:** T1565

## High-Level Description

Adversaries may insert, delete, or manipulate data at rest in order to influence external outcomes or hide activity, thus threatening the integrity of the data. By manipulating stored data, adversaries may attempt to affect a business process, organizational understanding, and decision making.

Stored data could include a variety of file formats, such as Office files, databases, stored emails, and custom file formats. The type of modification and the impact it will have depends on the type of data as well as the goals and objectives of the adversary. For complex systems, an adversary would likely need special expertise and possibly access to specialized software related to the system that would typically be gained through a prolonged information gathering campaign in order to have the desired impact.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Stored Data Manipulation technique is applicable to target environment
- [ ] Check Linux systems for indicators of Stored Data Manipulation
- [ ] Check macOS systems for indicators of Stored Data Manipulation
- [ ] Check Windows systems for indicators of Stored Data Manipulation
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Stored Data Manipulation by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1565.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Ensure least privilege principles are applied to important information resources to reduce exposure to data manipulation risk.

### M1029 Remote Data Storage

Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and manipulate backups.

### M1041 Encrypt Sensitive Information

Consider encrypting important information to reduce an adversary’s ability to perform tailored data modifications.

## Detection

### Detection Strategy for Stored Data Manipulation across OS Platforms.

## Risk Assessment

| Finding                                       | Severity | Impact |
| --------------------------------------------- | -------- | ------ |
| Stored Data Manipulation technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [DOJ Lazarus Sony 2018](https://www.justice.gov/opa/press-release/file/1092091/download)
- [FireEye APT38 Oct 2018](https://www.mandiant.com/sites/default/files/2021-09/rpt-apt38-2018-web_v5-1.pdf)
- [Atomic Red Team - T1565.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1565.001)
- [MITRE ATT&CK - T1565.001](https://attack.mitre.org/techniques/T1565/001)
