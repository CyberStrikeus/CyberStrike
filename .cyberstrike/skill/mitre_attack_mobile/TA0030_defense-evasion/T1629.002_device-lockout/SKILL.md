---
name: "T1629.002_device-lockout"
description: "An adversary may seek to inhibit user interaction by locking the legitimate user out of the device."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1629.002
  - defense-evasion
  - android
  - sub-technique
technique_id: "T1629.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1629/002"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1629
  - T1629.001
  - T1629.003
prerequisites:
  - T1629
severity_boost:
  T1629: "Chain with T1629 for deeper attack path"
  T1629.001: "Chain with T1629.001 for deeper attack path"
  T1629.003: "Chain with T1629.003 for deeper attack path"
---

# T1629.002 Device Lockout

> **Sub-technique of:** T1629

## High-Level Description

An adversary may seek to inhibit user interaction by locking the legitimate user out of the device. This is typically accomplished by requesting device administrator permissions and then locking the screen using `DevicePolicyManager.lockNow()`. Other novel techniques for locking the user out of the device have been observed, such as showing a persistent overlay, using carefully crafted “call” notification screens, and locking HTML pages in the foreground. These techniques can be very difficult to get around, and typically require booting the device into safe mode to uninstall the malware.

Prior to Android 7, device administrators were able to reset the device lock passcode to prevent the user from unlocking the device. The release of Android 7 introduced updates that only allow device or profile owners (e.g. MDMs) to reset the device’s passcode.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Device Lockout technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Device Lockout
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Device Lockout by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1629.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
Recent versions of Android modified how device administrator applications are uninstalled, making it easier for the user to remove them. Android 7 introduced updates that revoke standard device administrators’ ability to reset the device’s passcode.


## Detection

### Detection of Device Lockout


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Device Lockout technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Microsoft MalLockerB](https://www.microsoft.com/security/blog/2020/10/08/sophisticated-new-android-malware-marks-the-latest-evolution-of-mobile-ransomware/)
- [Android resetPassword](https://developer.android.com/reference/android/app/admin/DevicePolicyManager.html#resetPassword(java.lang.String,%20int))
- [securelist rotexy 2018](https://securelist.com/the-rotexy-mobile-trojan-banker-and-ransomware/88893/)
- [Talos GPlayed](https://blog.talosintelligence.com/2018/10/gplayedtrojan.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-22.html)
- [MITRE ATT&CK Mobile - T1629.002](https://attack.mitre.org/techniques/T1629/002)
