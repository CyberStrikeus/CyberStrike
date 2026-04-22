---
name: "T1417_input-capture"
description: "Adversaries may use methods of capturing user input to obtain credentials or collect information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1417
  - collection
  - credential-access
  - android
  - ios
technique_id: "T1417"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1417"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1417.001
  - T1417.002
prerequisites:
  []
severity_boost:
  T1417.001: "Chain with T1417.001 for deeper attack path"
  T1417.002: "Chain with T1417.002 for deeper attack path"
---

# T1417 Input Capture

## High-Level Description

Adversaries may use methods of capturing user input to obtain credentials or collect information. During normal device usage, users often provide credentials to various locations, such as login pages/portals or system dialog boxes. Input capture mechanisms may be transparent to the user (e.g. Keylogging) or rely on deceiving the user into providing input into what they believe to be a genuine application prompt (e.g. GUI Input Capture).

## Kill Chain Phase

- Collection (TA0035)
- Credential Access (TA0031)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Input Capture technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Input Capture
- [ ] Check iOS devices for indicators of Input Capture
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Input Capture by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1417 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1012 Enterprise Policy
When using Samsung Knox, third-party keyboards must be explicitly added to an allow list in order to be available to the end-user. An EMM/MDM can use the Android `DevicePolicyManager.setPermittedAccessibilityServices` method to set an explicit list of applications that are allowed to use Android's accessibility features.

### M1011 User Guidance
Users should be wary of granting applications dangerous or privacy-intrusive permissions, such as keyboard registration or accessibility service access.

### M1006 Use Recent OS Version
The `HIDE_OVERLAY_WINDOWS` permission was introduced in Android 12 allowing apps to hide overlay windows of type `TYPE_APPLICATION_OVERLAY` drawn by other apps with the `SYSTEM_ALERT_WINDOW` permission, preventing other applications from creating overlay windows on top of the current application.


## Detection

### Detection of Input Capture


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Input Capture technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-31.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/authentication-threats/AUT-13.html)
- [MITRE ATT&CK Mobile - T1417](https://attack.mitre.org/techniques/T1417)
