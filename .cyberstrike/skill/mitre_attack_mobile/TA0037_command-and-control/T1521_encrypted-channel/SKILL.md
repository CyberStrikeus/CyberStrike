---
name: "T1521_encrypted-channel"
description: "Adversaries may explicitly employ a known encryption algorithm to conceal command and control traffic rather than relying on any inherent protections provided by a communication protocol."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1521
  - command-and-control
  - android
  - ios
technique_id: "T1521"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1521"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1521.001
  - T1521.002
  - T1521.003
prerequisites:
  []
severity_boost:
  T1521.001: "Chain with T1521.001 for deeper attack path"
  T1521.002: "Chain with T1521.002 for deeper attack path"
  T1521.003: "Chain with T1521.003 for deeper attack path"
---

# T1521 Encrypted Channel

## High-Level Description

Adversaries may explicitly employ a known encryption algorithm to conceal command and control traffic rather than relying on any inherent protections provided by a communication protocol. Despite the use of a secure algorithm, these implementations may be vulnerable to reverse engineering if necessary secret keys are encoded and/or generated within malware samples/configuration files.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Encrypted Channel technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Encrypted Channel
- [ ] Check iOS devices for indicators of Encrypted Channel
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Encrypted Channel by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1521 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Encrypted Channel


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Encrypted Channel technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1521](https://attack.mitre.org/techniques/T1521)
