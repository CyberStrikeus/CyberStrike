---
name: "T1417.001_keylogging"
description: "Adversaries may log user keystrokes to intercept credentials or other information from the user as the user types them."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1417.001
  - collection
  - credential-access
  - android
  - ios
  - sub-technique
technique_id: "T1417.001"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1417/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1417
  - T1417.002
prerequisites:
  - T1417
severity_boost:
  T1417: "Chain with T1417 for deeper attack path"
  T1417.002: "Chain with T1417.002 for deeper attack path"
---

# T1417.001 Keylogging

> **Sub-technique of:** T1417

## High-Level Description

Adversaries may log user keystrokes to intercept credentials or other information from the user as the user types them.

Some methods of keylogging include:

* Masquerading as a legitimate third-party keyboard to record user keystrokes. On both Android and iOS, users must explicitly authorize the use of third-party keyboard apps. Users should be advised to use extreme caution before granting this authorization when it is requested.
* Abusing accessibility features. On Android, adversaries may abuse accessibility features to record keystrokes by registering an `AccessibilityService` class, overriding the `onAccessibilityEvent` method, and listening for the `AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED` event type. The event object passed into the function will contain the data that the user typed. 
*Additional methods of keylogging may be possible if root access is available.

## Kill Chain Phase

- Collection (TA0035)
- Credential Access (TA0031)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Keylogging technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Keylogging
- [ ] Check iOS devices for indicators of Keylogging
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Keylogging by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1417.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1012 Enterprise Policy
When using Samsung Knox, third-party keyboards must be explicitly added to an allow list in order to be available to the end-user.

### M1011 User Guidance
Users should be wary of granting applications dangerous or privacy-intrusive permissions, such as keyboard registration or accessibility service access.


## Detection

### Detection of Keylogging


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Keylogging technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Zeltser-Keyboard](https://zeltser.com/third-party-keyboards-security/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/authentication-threats/AUT-13.html)
- [MITRE ATT&CK Mobile - T1417.001](https://attack.mitre.org/techniques/T1417/001)
