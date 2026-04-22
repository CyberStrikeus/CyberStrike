---
name: "T1509_non-standard-port"
description: "Adversaries may generate network traffic using a protocol and port pairing that are typically not associated."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1509
  - command-and-control
  - android
  - ios
technique_id: "T1509"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1509"
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

# T1509 Non-Standard Port

## High-Level Description

Adversaries may generate network traffic using a protocol and port pairing that are typically not associated. For example, HTTPS over port 8088 or port 587 as opposed to the traditional port 443. Adversaries may make changes to the standard port used by a protocol to bypass filtering or muddle analysis/parsing of network data.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Non-Standard Port technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Non-Standard Port
- [ ] Check iOS devices for indicators of Non-Standard Port
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Non-Standard Port by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1509 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Non-Standard Port


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Non-Standard Port technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1509](https://attack.mitre.org/techniques/T1509)
