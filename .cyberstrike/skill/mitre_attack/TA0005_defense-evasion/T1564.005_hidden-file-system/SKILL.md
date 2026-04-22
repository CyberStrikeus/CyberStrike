---
name: "T1564.005_hidden-file-system"
description: "Adversaries may use a hidden file system to conceal malicious activity from users and security tools."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.005
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1564.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1564/005"
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
  - T1564.006
  - T1564.007
  - T1564.008
  - T1564.009
  - T1564.010
  - T1564.011
  - T1564.012
  - T1564.013
  - T1564.014
prerequisites:
  - T1564
severity_boost:
  T1564: "Chain with T1564 for deeper attack path"
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.002: "Chain with T1564.002 for deeper attack path"
---

# T1564.005 Hidden File System

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may use a hidden file system to conceal malicious activity from users and security tools. File systems provide a structure to store and access data from physical storage. Typically, a user engages with a file system through applications that allow them to access files and directories, which are an abstraction from their physical location (ex: disk sector). Standard file systems include FAT, NTFS, ext4, and APFS. File systems can also contain other structures, such as the Volume Boot Record (VBR) and Master File Table (MFT) in NTFS.

Adversaries may use their own abstracted file system, separate from the standard file system present on the infected system. In doing so, adversaries can hide the presence of malicious components and file input/output from security tools. Hidden file systems, sometimes referred to as virtual file systems, can be implemented in numerous ways. One implementation would be to store a file system in reserved disk space unused by disk structures or standard file system partitions. Another implementation could be for an adversary to drop their own portable partition image as a file on top of the standard file system. Adversaries may also fragment files across the existing file system structure in non-standard ways.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Hidden File System technique is applicable to target environment
- [ ] Check Linux systems for indicators of Hidden File System
- [ ] Check macOS systems for indicators of Hidden File System
- [ ] Check Windows systems for indicators of Hidden File System
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hidden File System by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Hidden File System Abuse

## Risk Assessment

| Finding                                 | Severity | Impact          |
| --------------------------------------- | -------- | --------------- |
| Hidden File System technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [MalwareTech VFS Nov 2014](https://www.malwaretech.com/2014/11/virtual-file-systems-for-beginners.html)
- [FireEye Bootkits](https://www.fireeye.com/blog/threat-research/2015/12/fin1-targets-boot-record.html)
- [ESET ComRAT May 2020](https://www.welivesecurity.com/wp-content/uploads/2020/05/ESET_Turla_ComRAT.pdf)
- [Kaspersky Equation QA](https://media.kasperskycontenthub.com/wp-content/uploads/sites/43/2018/03/08064459/Equation_group_questions_and_answers.pdf)
- [Atomic Red Team - T1564.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.005)
- [MITRE ATT&CK - T1564.005](https://attack.mitre.org/techniques/T1564/005)
