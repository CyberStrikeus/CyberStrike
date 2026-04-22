---
name: "T1623.001_unix-shell"
description: "Adversaries may abuse Unix shell commands and scripts for execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1623.001
  - execution
  - android
  - ios
  - sub-technique
technique_id: "T1623.001"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1623/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-94
chains_with:
  - T1623
prerequisites:
  - T1623
severity_boost:
  T1623: "Chain with T1623 for deeper attack path"
---

# T1623.001 Unix Shell

> **Sub-technique of:** T1623

## High-Level Description

Adversaries may abuse Unix shell commands and scripts for execution. Unix shells are the underlying command prompts on Android and iOS devices. Unix shells can control every aspect of a system, with certain commands requiring elevated privileges that are only accessible if the device has been rooted or jailbroken.

Unix shells also support scripts that enable sequential execution of commands as well as other typical programming operations such as conditionals and loops. Common uses of shell scripts include long or repetitive tasks, or the need to run the same set of commands on multiple systems.

Adversaries may abuse Unix shells to execute various commands or payloads. Interactive shells may be accessed through command and control channels or during lateral movement such as with SSH. Adversaries may also leverage shell scripts to deliver and execute multiple commands on victims or as part of payloads used for persistence.

If the device has been rooted or jailbroken, adversaries may locate and invoke a superuser binary to elevate their privileges and interact with the system as the root user. This dangerous level of permissions allows the adversary to run special commands and modify protected system files.

## Kill Chain Phase

- Execution (TA0041)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Unix Shell technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Unix Shell
- [ ] Check iOS devices for indicators of Unix Shell
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Unix Shell by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1623.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1002 Attestation

Device attestation can often detect jailbroken or rooted devices.

### M1010 Deploy Compromised Device Detection Method

Mobile security products can typically detect jailbroken or rooted devices.

## Detection

### Detection of Unix Shell

## Risk Assessment

| Finding                         | Severity | Impact    |
| ------------------------------- | -------- | --------- |
| Unix Shell technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Samsung Knox Mobile Threat Defense](https://partner.samsungknox.com/mtd)
- [MITRE ATT&CK Mobile - T1623.001](https://attack.mitre.org/techniques/T1623/001)
