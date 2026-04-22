---
name: "T1670_virtualization-solution"
description: "Adversaries may carry out malicious operations using virtualization solutions to escape from Android sandboxes and to avoid detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1670
  - defense-evasion
  - android
technique_id: "T1670"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1670"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1670 Virtualization Solution

## High-Level Description

Adversaries may carry out malicious operations using virtualization solutions to escape from Android sandboxes and to avoid detection. Android uses sandboxes to separate resources and code execution between applications and the operating system. There are a few virtualization solutions available on Android, such as the Android Virtualization Framework (AVF). 

 

Through virtualization solutions, adversaries may execute malicious operations without user knowledge. For example, adversaries may mimic a legitimate banking application’s functionalities in a virtual environment, thanks to the virtualization solution, while malicious code captures credentials.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Virtualization Solution technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Virtualization Solution
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Virtualization Solution by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1670 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should be encouraged to only install apps from authorized app stores, which are less likely to contain malicious applications.


## Detection

### Detection of Virtualization Solution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Virtualization Solution technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Android AVF Overview](https://source.android.com/docs/core/virtualization)
- [Android Application Sandbox](https://source.android.com/docs/security/app-sandbox)
- [MITRE ATT&CK Mobile - T1670](https://attack.mitre.org/techniques/T1670)
