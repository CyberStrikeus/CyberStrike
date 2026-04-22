---
name: "T1546.017_udev-rules"
description: "Adversaries may maintain persistence through executing malicious content triggered using udev rules."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.017
  - persistence
  - privilege-escalation
  - linux
  - sub-technique
technique_id: "T1546.017"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1546/017"
tech_stack:
  - linux
cwe_ids:
  - CWE-276
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.017 Udev Rules

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may maintain persistence through executing malicious content triggered using udev rules. Udev is the Linux kernel device manager that dynamically manages device nodes, handles access to pseudo-device files in the `/dev` directory, and responds to hardware events, such as when external devices like hard drives or keyboards are plugged in or removed. Udev uses rule files with `match keys` to specify the conditions a hardware event must meet and `action keys` to define the actions that should follow. Root permissions are required to create, modify, or delete rule files located in `/etc/udev/rules.d/`, `/run/udev/rules.d/`, `/usr/lib/udev/rules.d/`, `/usr/local/lib/udev/rules.d/`, and `/lib/udev/rules.d/`. Rule priority is determined by both directory and by the digit prefix in the rule filename.

Adversaries may abuse the udev subsystem by adding or modifying rules in udev rule files to execute malicious content. For example, an adversary may configure a rule to execute their binary each time the pseudo-device file, such as `/dev/random`, is accessed by an application. Although udev is limited to running short tasks and is restricted by systemd-udevd's sandbox (blocking network and filesystem access), attackers may use scripting commands under the action key `RUN+=` to detach and run the malicious content’s process in the background to bypass these controls.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Linux

## What to Check

- [ ] Identify if Udev Rules technique is applicable to target environment
- [ ] Check Linux systems for indicators of Udev Rules
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Udev Rules by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.017 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for T1546.017 - Udev Rules (Linux)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Udev Rules technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Ignacio Udev research 2024](https://ch4ik0.github.io/en/posts/leveraging-Linux-udev-for-persistence/)
- [Elastic Linux Persistence 2024](https://www.elastic.co/security-labs/sequel-on-persistence-mechanisms)
- [Reichert aon sedexp 2024](https://www.aon.com/en/insights/cyber-labs/unveiling-sedexp)
- [Atomic Red Team - T1546.017](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.017)
- [MITRE ATT&CK - T1546.017](https://attack.mitre.org/techniques/T1546/017)
