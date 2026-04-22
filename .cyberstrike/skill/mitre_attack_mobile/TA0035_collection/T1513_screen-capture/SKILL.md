---
name: "T1513_screen-capture"
description: "Adversaries may use screen capture to collect additional information about a target device, such as applications running in the foreground, user data, credentials, or other sensitive information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1513
  - collection
  - android
technique_id: "T1513"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1513"
tech_stack:
  - android
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1513 Screen Capture

## High-Level Description

Adversaries may use screen capture to collect additional information about a target device, such as applications running in the foreground, user data, credentials, or other sensitive information. Applications running in the background can capture screenshots or videos of another application running in the foreground by using the Android `MediaProjectionManager` (generally requires the device user to grant consent). Background applications can also use Android accessibility services to capture screen contents being displayed by a foreground application. An adversary with root access or Android Debug Bridge (adb) access could call the Android `screencap` or `screenrecord` commands.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android

## What to Check

- [ ] Identify if Screen Capture technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Screen Capture
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Screen Capture by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1513 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1012 Enterprise Policy
Enterprise policies should block access to the Android Debug Bridge (ADB) by preventing users from enabling USB debugging on Android devices unless specifically needed (e.g., if the device is used for application development). An EMM/MDM can use the Android `DevicePolicyManager.setPermittedAccessibilityServices` method to set an explicit list of applications that are allowed to use Android's accessibility features.

### M1011 User Guidance
Users should be advised not to grant consent for screen captures to occur unless expected. Users should avoid enabling USB debugging (Android Debug Bridge) unless explicitly required.

### M1013 Application Developer Guidance
Application developers can apply the `FLAG_SECURE` property to sensitive screens within their apps to make it more difficult for the screen contents to be captured.


## Detection

### Detection of Screen Capture


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Screen Capture technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Android ScreenCap2 2019](https://developer.android.com/studio/command-line/adb)
- [Android ScreenCap1 2019](https://developer.android.com/reference/android/media/projection/MediaProjectionManager)
- [Lookout-Monokle](https://www.lookout.com/documents/threat-reports/lookout-discovers-monokle-threat-report.pdf)
- [Fortinet screencap July 2019](https://www.fortinet.com/blog/threat-research/new-wave-bianlian-malware.html)
- [Trend Micro ScreenCap July 2015](https://blog.trendmicro.com/trendlabs-security-intelligence/hacking-team-rcsandroid-spying-tool-listens-to-calls-roots-devices-to-get-in/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-40.html)
- [MITRE ATT&CK Mobile - T1513](https://attack.mitre.org/techniques/T1513)
