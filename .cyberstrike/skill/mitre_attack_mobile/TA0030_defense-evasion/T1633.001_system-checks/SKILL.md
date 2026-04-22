---
name: "T1633.001_system-checks"
description: "Adversaries may employ various system checks to detect and avoid virtualization and analysis environments."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1633.001
  - defense-evasion
  - android
  - ios
  - sub-technique
technique_id: "T1633.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1633/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1633
prerequisites:
  - T1633
severity_boost:
  T1633: "Chain with T1633 for deeper attack path"
---

# T1633.001 System Checks

> **Sub-technique of:** T1633

## High-Level Description

Adversaries may employ various system checks to detect and avoid virtualization and analysis environments. This may include changing behavior after checking for the presence of artifacts indicative of a virtual environment or sandbox. If the adversary detects a virtual environment, they may alter their malware’s behavior to disengage from the victim or conceal the core functions of the implant. They may also search for virtualization artifacts before dropping secondary or additional payloads. 

Checks could include generic system properties such as host/domain name and samples of network traffic. Adversaries may also check the network adapters addresses, CPU core count, and available memory/drive size. 

Hardware checks, such as the presence of motion sensors, could also be used to gather evidence that can be indicative a virtual environment. Adversaries may also query for specific readings from these devices.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if System Checks technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of System Checks
- [ ] Check iOS devices for indicators of System Checks
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to System Checks by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1633.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of System Checks


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Checks technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [MITRE ATT&CK Mobile - T1633.001](https://attack.mitre.org/techniques/T1633/001)
