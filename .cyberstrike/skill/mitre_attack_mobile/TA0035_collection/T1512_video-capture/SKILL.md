---
name: "T1512_video-capture"
description: "An adversary can leverage a device’s cameras to gather information by capturing video recordings."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1512
  - collection
  - android
  - ios
technique_id: "T1512"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1512"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1512 Video Capture

## High-Level Description

An adversary can leverage a device’s cameras to gather information by capturing video recordings. Images may also be captured, potentially in specified intervals, in lieu of video files. 

 

Malware or scripts may interact with the device cameras through an available API provided by the operating system. Video or image files may be written to disk and exfiltrated later. This technique differs from Screen Capture due to use of the device’s cameras for video recording rather than capturing the victim’s screen. 

 

In Android, an application must hold the `android.permission.CAMERA` permission to access the cameras. In iOS, applications must include the `NSCameraUsageDescription` key in the `Info.plist` file. In both cases, the user must grant permission to the requesting application to use the camera. If the device has been rooted or jailbroken, an adversary may be able to access the camera without knowledge of the user.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Video Capture technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Video Capture
- [ ] Check iOS devices for indicators of Video Capture
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Video Capture by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1512 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
Android 9 and above restricts access to the mic, camera, and other device sensors from applications running in the background. iOS 14 and Android 12 introduced a visual indicator on the status bar (green dot) when an application is accessing the device’s camera.


## Detection

### Detection of Video Capture


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Video Capture technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-19.html)
- [MITRE ATT&CK Mobile - T1512](https://attack.mitre.org/techniques/T1512)
