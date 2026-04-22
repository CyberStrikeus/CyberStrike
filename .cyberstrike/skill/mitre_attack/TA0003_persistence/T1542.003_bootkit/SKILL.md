---
name: "T1542.003_bootkit"
description: "Adversaries may use bootkits to persist on systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1542.003
  - persistence
  - defense-evasion
  - linux
  - windows
  - sub-technique
technique_id: "T1542.003"
tactic: "persistence"
all_tactics:
  - persistence
  - defense-evasion
platforms:
  - Linux
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1542/003"
tech_stack:
  - linux
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1542
  - T1542.001
  - T1542.002
  - T1542.004
  - T1542.005
prerequisites:
  - T1542
severity_boost:
  T1542: "Chain with T1542 for deeper attack path"
  T1542.001: "Chain with T1542.001 for deeper attack path"
  T1542.002: "Chain with T1542.002 for deeper attack path"
---

# T1542.003 Bootkit

> **Sub-technique of:** T1542

## High-Level Description

Adversaries may use bootkits to persist on systems. A bootkit is a malware variant that modifies the boot sectors of a hard drive, allowing malicious code to execute before a computer's operating system has loaded. Bootkits reside at a layer below the operating system and may make it difficult to perform full remediation unless an organization suspects one was used and can act accordingly.

In BIOS systems, a bootkit may modify the Master Boot Record (MBR) and/or Volume Boot Record (VBR). The MBR is the section of disk that is first loaded after completing hardware initialization by the BIOS. It is the location of the boot loader. An adversary who has raw access to the boot drive may overwrite this area, diverting execution during startup from the normal boot loader to adversary code.

The MBR passes control of the boot process to the VBR. Similar to the case of MBR, an adversary who has raw access to the boot drive may overwrite the VBR to divert execution during startup to adversary code.

In UEFI (Unified Extensible Firmware Interface) systems, a bootkit may instead create or modify files in the EFI system partition (ESP). The ESP is a partition on data storage used by devices containing UEFI that allows the system to boot the OS and other utilities used by the system. An adversary can use the newly created or patched files in the ESP to run malicious kernel code.

## Kill Chain Phase

- Persistence (TA0003)
- Defense Evasion (TA0005)

**Platforms:** Linux, Windows

## What to Check

- [ ] Identify if Bootkit technique is applicable to target environment
- [ ] Check Linux systems for indicators of Bootkit
- [ ] Check Windows systems for indicators of Bootkit
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Bootkit by examining the target platforms (Linux, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1542.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1046 Boot Integrity
Use Trusted Platform Module technology and a secure or trusted boot process to prevent system integrity from being compromised.

### M1026 Privileged Account Management
Ensure proper permissions are in place to help prevent adversary access to privileged accounts necessary to install a bootkit.


## Detection

### Detection Strategy for File Creation or Modification of Boot Files


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Bootkit technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Lau 2011](http://www.symantec.com/connect/blogs/are-mbr-infections-back-fashion)
- [Mandiant M Trends 2016](https://web.archive.org/web/20211024160454/https://www.fireeye.com/content/dam/fireeye-www/current-threats/pdfs/rpt-mtrends-2016.pdf)
- [welivesecurity](https://www.welivesecurity.com/2023/03/01/blacklotus-uefi-bootkit-myth-confirmed/)
- [Microsoft Security](https://www.microsoft.com/en-us/security/blog/2023/04/11/guidance-for-investigating-attacks-using-cve-2022-21894-the-blacklotus-campaign/)
- [Atomic Red Team - T1542.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1542.003)
- [MITRE ATT&CK - T1542.003](https://attack.mitre.org/techniques/T1542/003)
