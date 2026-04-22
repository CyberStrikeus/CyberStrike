---
name: "T1561_disk-wipe"
description: "Adversaries may wipe or corrupt raw disk data on specific systems or in large numbers in a network to interrupt availability to system and network resources."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1561
  - impact
  - linux
  - macos
  - windows
  - network-devices
technique_id: "T1561"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1561"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
cwe_ids:
  - CWE-400
chains_with:
  - T1561.001
  - T1561.002
prerequisites: []
severity_boost:
  T1561.001: "Chain with T1561.001 for deeper attack path"
  T1561.002: "Chain with T1561.002 for deeper attack path"
---

# T1561 Disk Wipe

## High-Level Description

Adversaries may wipe or corrupt raw disk data on specific systems or in large numbers in a network to interrupt availability to system and network resources. With direct write access to a disk, adversaries may attempt to overwrite portions of disk data. Adversaries may opt to wipe arbitrary portions of disk data and/or wipe disk structures like the master boot record (MBR). A complete wipe of all disk sectors may be attempted.

To maximize impact on the target organization in operations where network-wide availability interruption is the goal, malware used for wiping disks may have worm-like features to propagate across a network by leveraging additional techniques like Valid Accounts, OS Credential Dumping, and SMB/Windows Admin Shares.

On network devices, adversaries may wipe configuration files and other data from the device using Network Device CLI commands such as `erase`.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Windows, Network Devices

## What to Check

- [ ] Identify if Disk Wipe technique is applicable to target environment
- [ ] Check Linux systems for indicators of Disk Wipe
- [ ] Check macOS systems for indicators of Disk Wipe
- [ ] Check Windows systems for indicators of Disk Wipe
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disk Wipe by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1561 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1053 Data Backup

Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery.

## Detection

### Detection Strategy for Disk Wipe via Direct Disk Access and Destructive Commands

## Risk Assessment

| Finding                        | Severity | Impact |
| ------------------------------ | -------- | ------ |
| Disk Wipe technique applicable | High     | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [erase_cmd_cisco](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/D_through_E.html#wp3557227463)
- [Novetta Blockbuster Destructive Malware](https://web.archive.org/web/20160303200515/https:/operationblockbuster.com/wp-content/uploads/2016/02/Operation-Blockbuster-Destructive-Malware-Report.pdf)
- [Microsoft Sysmon v6 May 2017](https://docs.microsoft.com/sysinternals/downloads/sysmon)
- [Atomic Red Team - T1561](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1561)
- [MITRE ATT&CK - T1561](https://attack.mitre.org/techniques/T1561)
