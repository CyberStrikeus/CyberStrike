---
name: "T1542_pre-os-boot"
description: "Adversaries may abuse Pre-OS Boot mechanisms as a way to establish persistence on a system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1542
  - defense-evasion
  - persistence
  - linux
  - network-devices
  - windows
  - macos
technique_id: "T1542"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
platforms:
  - Linux
  - Network Devices
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1542"
tech_stack:
  - linux
  - network devices
  - windows
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1542.001
  - T1542.002
  - T1542.003
  - T1542.004
  - T1542.005
prerequisites:
  []
severity_boost:
  T1542.001: "Chain with T1542.001 for deeper attack path"
  T1542.002: "Chain with T1542.002 for deeper attack path"
  T1542.003: "Chain with T1542.003 for deeper attack path"
---

# T1542 Pre-OS Boot

## High-Level Description

Adversaries may abuse Pre-OS Boot mechanisms as a way to establish persistence on a system. During the booting process of a computer, firmware and various startup services are loaded before the operating system. These programs control flow of execution before the operating system takes control.

Adversaries may overwrite data in boot drivers or firmware such as BIOS (Basic Input/Output System) and The Unified Extensible Firmware Interface (UEFI) to persist on systems at a layer below the operating system. This can be particularly difficult to detect as malware at this level will not be detected by host software-based defenses.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Linux, Network Devices, Windows, macOS

## What to Check

- [ ] Identify if Pre-OS Boot technique is applicable to target environment
- [ ] Check Linux systems for indicators of Pre-OS Boot
- [ ] Check Network Devices systems for indicators of Pre-OS Boot
- [ ] Check Windows systems for indicators of Pre-OS Boot
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Pre-OS Boot by examining the target platforms (Linux, Network Devices, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1542 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1035 Limit Access to Resource Over Network
Prevent access to file shares, remote access to systems, unnecessary services. Mechanisms to limit access may include use of network concentrators, RDP gateways, etc.

### M1047 Audit
Perform audits or scans of systems, permissions, insecure software, insecure configurations, etc. to identify potential weaknesses.

### M1051 Update Software
Patch the BIOS and EFI as necessary.

### M1026 Privileged Account Management
Ensure proper permissions are in place to help prevent adversary access to privileged accounts necessary to perform these actions

### M1046 Boot Integrity
Use Trusted Platform Module technology and a secure or trusted boot process to prevent system integrity from being compromised. Check the integrity of the existing BIOS or EFI to determine if it is vulnerable to modification.


## Detection

### Detection Strategy for T1542 Pre-OS Boot


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Pre-OS Boot technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [ITWorld Hard Disk Health Dec 2014](https://www.computerworld.com/article/1484887/3-tools-to-check-your-hard-drives-health-and-make-sure-its-not-already-dying-on-you.html)
- [Wikipedia Booting](https://en.wikipedia.org/wiki/Booting)
- [Atomic Red Team - T1542](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1542)
- [MITRE ATT&CK - T1542](https://attack.mitre.org/techniques/T1542)
