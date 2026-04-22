---
name: "T1626.001_device-administrator-permissions"
description: "Adversaries may abuse Android’s device administration API to obtain a higher degree of control over the device."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1626.001
  - privilege-escalation
  - android
  - sub-technique
technique_id: "T1626.001"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1626/001"
tech_stack:
  - android
cwe_ids:
  - CWE-269
chains_with:
  - T1626
prerequisites:
  - T1626
severity_boost:
  T1626: "Chain with T1626 for deeper attack path"
---

# T1626.001 Device Administrator Permissions

> **Sub-technique of:** T1626

## High-Level Description

Adversaries may abuse Android’s device administration API to obtain a higher degree of control over the device. By abusing the API, adversaries can perform several nefarious actions, such as resetting the device’s password for Endpoint Denial of Service, factory resetting the device for File Deletion and to delete any traces of the malware, disabling all the device’s cameras, or to make it more difficult to uninstall the app.

Device administrators must be approved by the user at runtime, with a system popup showing which actions have been requested by the app. In conjunction with other techniques, such as Input Injection, an app can programmatically grant itself administrator permissions without any user input.

## Kill Chain Phase

- Privilege Escalation (TA0029)

**Platforms:** Android

## What to Check

- [ ] Identify if Device Administrator Permissions technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Device Administrator Permissions
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Device Administrator Permissions by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1626.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
Changes were introduced in Android 7 to make abuse of device administrator permissions more difficult.

### M1011 User Guidance
Users should scrutinize every device administration permission request. If the request is not expected or the user does not recognize the application, the application should be uninstalled immediately.


## Detection

### Detection of Device Administrator Permissions


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Device Administrator Permissions technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-22.html)
- [MITRE ATT&CK Mobile - T1626.001](https://attack.mitre.org/techniques/T1626/001)
