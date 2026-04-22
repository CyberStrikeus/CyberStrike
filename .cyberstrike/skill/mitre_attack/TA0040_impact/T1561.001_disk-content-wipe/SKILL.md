---
name: "T1561.001_disk-content-wipe"
description: "Adversaries may erase the contents of storage devices on specific systems or in large numbers in a network to interrupt availability to system and network resources."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1561.001
  - impact
  - linux
  - network-devices
  - windows
  - macos
  - sub-technique
technique_id: "T1561.001"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - Network Devices
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1561/001"
tech_stack:
  - linux
  - network devices
  - windows
  - macos
cwe_ids:
  - CWE-400
chains_with:
  - T1561
  - T1561.002
prerequisites:
  - T1561
severity_boost:
  T1561: "Chain with T1561 for deeper attack path"
  T1561.002: "Chain with T1561.002 for deeper attack path"
---

# T1561.001 Disk Content Wipe

> **Sub-technique of:** T1561

## High-Level Description

Adversaries may erase the contents of storage devices on specific systems or in large numbers in a network to interrupt availability to system and network resources.

Adversaries may partially or completely overwrite the contents of a storage device rendering the data irrecoverable through the storage interface. Instead of wiping specific disk structures or files, adversaries with destructive intent may wipe arbitrary portions of disk content. To wipe disk content, adversaries may acquire direct access to the hard drive in order to overwrite arbitrarily sized portions of disk with random data. Adversaries have also been observed leveraging third-party drivers like RawDisk to directly access disk content. This behavior is distinct from Data Destruction because sections of the disk are erased instead of individual files.

To maximize impact on the target organization in operations where network-wide availability interruption is the goal, malware used for wiping disk content may have worm-like features to propagate across a network by leveraging additional techniques like Valid Accounts, OS Credential Dumping, and SMB/Windows Admin Shares.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, Network Devices, Windows, macOS

## What to Check

- [ ] Identify if Disk Content Wipe technique is applicable to target environment
- [ ] Check Linux systems for indicators of Disk Content Wipe
- [ ] Check Network Devices systems for indicators of Disk Content Wipe
- [ ] Check Windows systems for indicators of Disk Content Wipe
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disk Content Wipe by examining the target platforms (Linux, Network Devices, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1561.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1053 Data Backup
Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery.


## Detection

### Detection Strategy for Disk Content Wipe via Direct Access and Overwrite


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Disk Content Wipe technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [DOJ Lazarus Sony 2018](https://www.justice.gov/opa/press-release/file/1092091/download)
- [Novetta Blockbuster Destructive Malware](https://web.archive.org/web/20160303200515/https:/operationblockbuster.com/wp-content/uploads/2016/02/Operation-Blockbuster-Destructive-Malware-Report.pdf)
- [Novetta Blockbuster](https://web.archive.org/web/20160226161828/https://www.operationblockbuster.com/wp-content/uploads/2016/02/Operation-Blockbuster-Report.pdf)
- [Microsoft Sysmon v6 May 2017](https://docs.microsoft.com/sysinternals/downloads/sysmon)
- [Atomic Red Team - T1561.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1561.001)
- [MITRE ATT&CK - T1561.001](https://attack.mitre.org/techniques/T1561/001)
