---
name: "T1629.001_prevent-application-removal"
description: "Adversaries may abuse the Android device administration API to prevent the user from uninstalling a target application."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1629.001
  - defense-evasion
  - android
  - sub-technique
technique_id: "T1629.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1629/001"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1629
  - T1629.002
  - T1629.003
prerequisites:
  - T1629
severity_boost:
  T1629: "Chain with T1629 for deeper attack path"
  T1629.002: "Chain with T1629.002 for deeper attack path"
  T1629.003: "Chain with T1629.003 for deeper attack path"
---

# T1629.001 Prevent Application Removal

> **Sub-technique of:** T1629

## High-Level Description

Adversaries may abuse the Android device administration API to prevent the user from uninstalling a target application. In earlier versions of Android, device administrator applications needed their administration capabilities explicitly deactivated by the user before the application could be uninstalled. This was later updated so the user could deactivate and uninstall the administrator application in one step.

Adversaries may also abuse the device accessibility APIs to prevent removal. This set of APIs allows the application to perform certain actions on behalf of the user and programmatically determine what is being shown on the screen. The malicious application could monitor the device screen for certain modals (e.g., the confirmation modal to uninstall an application) and inject screen input or a back button tap to close the modal. For example, Android's `performGlobalAction(int)` API could be utilized to prevent the user from removing the malicious application from the device after installation. If the user wants to uninstall the malicious application, two cases may occur, both preventing the user from removing the application.

- Case 1: If the integer argument passed to the API call is `2` or `GLOBAL_ACTION_HOME`, the malicious application may direct the user to the home screen from settings screen

- Case 2: If the integer argument passed to the API call is `1` or `GLOBAL_ACTION_BACK`, the malicious application may emulate the back press event

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Prevent Application Removal technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Prevent Application Removal
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Prevent Application Removal by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1629.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

Recent versions of Android modified how device administrator applications are uninstalled, making it easier for the user to remove them.

### M1011 User Guidance

Users should be warned against granting access to accessibility features and device administration services, and to carefully scrutinize applications that request these dangerous permissions. Users should be taught how to boot into safe mode to uninstall malicious applications that may be interfering with the uninstallation process.

### M1012 Enterprise Policy

An EMM/MDM can use the Android `DevicePolicyManager.setPermittedAccessibilityServices` method to set an explicit list of applications that are allowed to use Android's accessibility features.

## Detection

### Detection of Prevent Application Removal

## Risk Assessment

| Finding                                          | Severity | Impact          |
| ------------------------------------------------ | -------- | --------------- |
| Prevent Application Removal technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-22.html)
- [MITRE ATT&CK Mobile - T1629.001](https://attack.mitre.org/techniques/T1629/001)
