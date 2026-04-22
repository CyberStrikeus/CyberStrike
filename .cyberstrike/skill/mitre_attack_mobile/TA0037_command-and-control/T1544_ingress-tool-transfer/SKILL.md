---
name: "T1544_ingress-tool-transfer"
description: "Adversaries may transfer tools or other files from an external system onto a compromised device to facilitate follow-on actions."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1544
  - command-and-control
  - android
  - ios
technique_id: "T1544"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1544"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1544 Ingress Tool Transfer

## High-Level Description

Adversaries may transfer tools or other files from an external system onto a compromised device to facilitate follow-on actions. Files may be copied from an external adversary-controlled system through the command and control channel or through alternate protocols with another tool such as FTP.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Ingress Tool Transfer technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Ingress Tool Transfer
- [ ] Check iOS devices for indicators of Ingress Tool Transfer
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Ingress Tool Transfer by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1544 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Ingress Tool Transfer


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Ingress Tool Transfer technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1544](https://attack.mitre.org/techniques/T1544)
