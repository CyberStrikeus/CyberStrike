---
name: "T1561.002_disk-structure-wipe"
description: "Adversaries may corrupt or wipe the disk data structures on a hard drive necessary to boot a system; targeting specific critical systems or in large numbers in a network to interrupt availability t..."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1561.002
  - impact
  - linux
  - macos
  - windows
  - network-devices
  - sub-technique
technique_id: "T1561.002"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1561/002"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
cwe_ids:
  - CWE-400
chains_with:
  - T1561
  - T1561.001
prerequisites:
  - T1561
severity_boost:
  T1561: "Chain with T1561 for deeper attack path"
  T1561.001: "Chain with T1561.001 for deeper attack path"
---

# T1561.002 Disk Structure Wipe

> **Sub-technique of:** T1561

## High-Level Description

Adversaries may corrupt or wipe the disk data structures on a hard drive necessary to boot a system; targeting specific critical systems or in large numbers in a network to interrupt availability to system and network resources. 

Adversaries may attempt to render the system unable to boot by overwriting critical data located in structures such as the master boot record (MBR) or partition table. The data contained in disk structures may include the initial executable code for loading an operating system or the location of the file system partitions on disk. If this information is not present, the computer will not be able to load an operating system during the boot process, leaving the computer unavailable. Disk Structure Wipe may be performed in isolation, or along with Disk Content Wipe if all sectors of a disk are wiped.

On a network devices, adversaries may reformat the file system using Network Device CLI commands such as `format`.

To maximize impact on the target organization, malware designed for destroying disk structures may have worm-like features to propagate across a network by leveraging other techniques like Valid Accounts, OS Credential Dumping, and SMB/Windows Admin Shares.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Windows, Network Devices

## What to Check

- [ ] Identify if Disk Structure Wipe technique is applicable to target environment
- [ ] Check Linux systems for indicators of Disk Structure Wipe
- [ ] Check macOS systems for indicators of Disk Structure Wipe
- [ ] Check Windows systems for indicators of Disk Structure Wipe
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disk Structure Wipe by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1561.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1053 Data Backup
Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery.


## Detection

### Detection Strategy for Disk Structure Wipe via Boot/Partition Overwrite


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Disk Structure Wipe technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [format_cmd_cisco](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/F_through_K.html#wp2829794668)
- [Unit 42 Shamoon3 2018](https://unit42.paloaltonetworks.com/shamoon-3-targets-oil-gas-organization/)
- [Palo Alto Shamoon Nov 2016](http://researchcenter.paloaltonetworks.com/2016/11/unit42-shamoon-2-return-disttrack-wiper/)
- [FireEye Shamoon Nov 2016](https://web.archive.org/web/20210126065851/https://www.fireeye.com/blog/threat-research/2016/11/fireeye_respondsto.html)
- [Kaspersky StoneDrill 2017](https://media.kasperskycontenthub.com/wp-content/uploads/sites/43/2018/03/07180722/Report_Shamoon_StoneDrill_final.pdf)
- [Microsoft Sysmon v6 May 2017](https://docs.microsoft.com/sysinternals/downloads/sysmon)
- [Symantec Shamoon 2012](https://www.symantec.com/connect/blogs/shamoon-attacks)
- [Atomic Red Team - T1561.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1561.002)
- [MITRE ATT&CK - T1561.002](https://attack.mitre.org/techniques/T1561/002)
