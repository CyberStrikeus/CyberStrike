---
name: "T1541_foreground-persistence"
description: "Adversaries may abuse Android's `startForeground()` API method to maintain continuous sensor access."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1541
  - defense-evasion
  - persistence
  - android
technique_id: "T1541"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1541"
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

# T1541 Foreground Persistence

## High-Level Description

Adversaries may abuse Android's `startForeground()` API method to maintain continuous sensor access. Beginning in Android 9, idle applications running in the background no longer have access to device sensors, such as the camera, microphone, and gyroscope. Applications can retain sensor access by running in the foreground, using Android’s `startForeground()` API method. This informs the system that the user is actively interacting with the application, and it should not be killed. The only requirement to start a foreground service is showing a persistent notification to the user.

Malicious applications may abuse the `startForeground()` API method to continue running in the foreground, while presenting a notification to the user pretending to be a genuine application. This would allow unhindered access to the device’s sensors, assuming permission has been previously granted.

Malicious applications may also abuse the `startForeground()` API to inform the Android system that the user is actively interacting with the application, thus preventing it from being killed by the low memory killer.

## Kill Chain Phase

- Defense Evasion (TA0030)
- Persistence (TA0028)

**Platforms:** Android

## What to Check

- [ ] Identify if Foreground Persistence technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Foreground Persistence
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Foreground Persistence by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1541 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
If a user sees a persistent notification they do not recognize, they should uninstall the source application and look for other unwanted applications or anomalies.


## Detection

### Detection of Foreground Persistence


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Foreground Persistence technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Android-SensorsOverview](https://developer.android.com/guide/topics/sensors/sensors_overview#sensors-practices)
- [Android-ForegroundServices](https://developer.android.com/guide/components/services.html#Foreground)
- [TrendMicro-Yellow Camera](https://blog.trendmicro.com/trendlabs-security-intelligence/fake-photo-beautification-apps-on-google-play-can-read-sms-verification-code-to-trigger-wireless-application-protocol-wap-carrier-billing/)
- [BlackHat Sutter Android Foreground 2019](https://i.blackhat.com/eu-19/Thursday/eu-19-Sutter-Simple-Spyware-Androids-Invisible-Foreground-Services-And-How-To-Abuse-Them.pdf)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-19.html)
- [MITRE ATT&CK Mobile - T1541](https://attack.mitre.org/techniques/T1541)
