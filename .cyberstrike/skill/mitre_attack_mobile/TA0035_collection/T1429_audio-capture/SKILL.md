---
name: "T1429_audio-capture"
description: "Adversaries may capture audio to collect information by leveraging standard operating system APIs of a mobile device."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1429
  - collection
  - android
  - ios
technique_id: "T1429"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1429"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1429 Audio Capture

## High-Level Description

Adversaries may capture audio to collect information by leveraging standard operating system APIs of a mobile device. Examples of audio information adversaries may target include user conversations, surroundings, phone calls, or other sensitive information.

Android and iOS, by default, require that applications request device microphone access from the user.

On Android devices, applications must hold the `RECORD_AUDIO` permission to access the microphone or the `CAPTURE_AUDIO_OUTPUT` permission to access audio output. Because Android does not allow third-party applications to hold the `CAPTURE_AUDIO_OUTPUT` permission by default, only privileged applications, such as those distributed by Google or the device vendor, can access audio output. However, adversaries may be able to gain this access after successfully elevating their privileges. With the `CAPTURE_AUDIO_OUTPUT` permission, adversaries may pass the `MediaRecorder.AudioSource.VOICE_CALL` constant to `MediaRecorder.setAudioOutput`, allowing capture of both voice call uplink and downlink.

On iOS devices, applications must include the `NSMicrophoneUsageDescription` key in their `Info.plist` file to access the microphone.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Audio Capture technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Audio Capture
- [ ] Check iOS devices for indicators of Audio Capture
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Audio Capture by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1429 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

Android 9 and above restricts access to microphone, camera, and other sensors from background applications.

### M1011 User Guidance

Users should be wary of granting applications dangerous or privacy-intrusive permissions, such as access to microphone or audio output.

## Detection

### Detection of Audio Capture

## Risk Assessment

| Finding                            | Severity | Impact     |
| ---------------------------------- | -------- | ---------- |
| Audio Capture technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Manifest.permission](https://developer.android.com/reference/android/media/MediaRecorder.AudioSource#VOICE_CALL)
- [Requesting Auth-Media Capture](https://developer.apple.com/documentation/avfoundation/cameras_and_media_capture/requesting_authorization_for_media_capture_on_ios)
- [Android Permissions](https://developer.android.com/reference/android/Manifest.permission)
- [Android Privacy Indicators](https://source.android.com/devices/tech/config/privacy-indicators)
- [iOS Mic Spyware](https://blog.zecops.com/research/how-ios-malware-can-spy-on-users-silently/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-19.html)
- [MITRE ATT&CK Mobile - T1429](https://attack.mitre.org/techniques/T1429)
