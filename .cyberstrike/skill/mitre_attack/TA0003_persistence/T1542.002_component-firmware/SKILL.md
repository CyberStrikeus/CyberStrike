---
name: "T1542.002_component-firmware"
description: "Adversaries may modify component firmware to persist on systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1542.002
  - persistence
  - defense-evasion
  - windows
  - linux
  - macos
  - sub-technique
technique_id: "T1542.002"
tactic: "persistence"
all_tactics:
  - persistence
  - defense-evasion
platforms:
  - Windows
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1542/002"
tech_stack:
  - windows
  - linux
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1542
  - T1542.001
  - T1542.003
  - T1542.004
  - T1542.005
prerequisites:
  - T1542
severity_boost:
  T1542: "Chain with T1542 for deeper attack path"
  T1542.001: "Chain with T1542.001 for deeper attack path"
  T1542.003: "Chain with T1542.003 for deeper attack path"
---

# T1542.002 Component Firmware

> **Sub-technique of:** T1542

## High-Level Description

Adversaries may modify component firmware to persist on systems. Some adversaries may employ sophisticated means to compromise computer components and install malicious firmware that will execute adversary code outside of the operating system and main system firmware or BIOS. This technique may be similar to System Firmware but conducted upon other system components/devices that may not have the same capability or level of integrity checking.

Malicious component firmware could provide both a persistent level of access to systems despite potential typical failures to maintain access and hard disk re-images, as well as a way to evade host software-based defenses and integrity checks.

## Kill Chain Phase

- Persistence (TA0003)
- Defense Evasion (TA0005)

**Platforms:** Windows, Linux, macOS

## What to Check

- [ ] Identify if Component Firmware technique is applicable to target environment
- [ ] Check Windows systems for indicators of Component Firmware
- [ ] Check Linux systems for indicators of Component Firmware
- [ ] Check macOS systems for indicators of Component Firmware
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Component Firmware by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1542.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1051 Update Software
Perform regular firmware updates to mitigate risks of exploitation and/or abuse.


## Detection

### Detection Strategy for T1542.002 Pre-OS Boot: Component Firmware


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Component Firmware technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [ITWorld Hard Disk Health Dec 2014](https://www.computerworld.com/article/1484887/3-tools-to-check-your-hard-drives-health-and-make-sure-its-not-already-dying-on-you.html)
- [SmartMontools](https://www.smartmontools.org/)
- [Atomic Red Team - T1542.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1542.002)
- [MITRE ATT&CK - T1542.002](https://attack.mitre.org/techniques/T1542/002)
