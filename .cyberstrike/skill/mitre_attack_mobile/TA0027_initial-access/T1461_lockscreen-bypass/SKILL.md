---
name: "T1461_lockscreen-bypass"
description: "An adversary with physical access to a mobile device may seek to bypass the device’s lockscreen."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1461
  - initial-access
  - android
  - ios
technique_id: "T1461"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1461"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1461 Lockscreen Bypass

## High-Level Description

An adversary with physical access to a mobile device may seek to bypass the device’s lockscreen. Several methods exist to accomplish this, including:

- Biometric spoofing: If biometric authentication is used, an adversary could attempt to spoof a mobile device’s biometric authentication mechanism. Both iOS and Android partly mitigate this attack by requiring the device’s passcode rather than biometrics to unlock the device after every device restart, and after a set or random amount of time.
- Unlock code bypass: An adversary could attempt to brute-force or otherwise guess the lockscreen passcode (typically a PIN or password), including physically observing (“shoulder surfing”) the device owner’s use of the lockscreen passcode. Mobile OS vendors partly mitigate this by implementing incremental backoff timers after a set number of failed unlock attempts, as well as a configurable full device wipe after several failed unlock attempts.
- Vulnerability exploit: Techniques have been periodically demonstrated that exploit mobile devices to bypass the lockscreen. The vulnerabilities are generally patched by the device or OS vendor once disclosed.

## Kill Chain Phase

- Initial Access (TA0027)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Lockscreen Bypass technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Lockscreen Bypass
- [ ] Check iOS devices for indicators of Lockscreen Bypass
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Lockscreen Bypass by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1461 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1012 Enterprise Policy

Enterprises can provision policies to mobile devices that require a minimum complexity (length, character requirements, etc.) for the device passcode, and cause the device to wipe all data if an incorrect passcode is entered too many times. Both policies would mitigate brute-force, guessing, or shoulder surfing of the device passcode. Enterprises can also provision policies to disable biometric authentication, however, biometric authentication can help make using a longer, more complex passcode more practical because it does not need to be entered as frequently.

### M1001 Security Updates

OS security updates typically contain exploit patches when disclosed.

## Detection

### Detection of Lockscreen Bypass

## Risk Assessment

| Finding                                | Severity | Impact         |
| -------------------------------------- | -------- | -------------- |
| Lockscreen Bypass technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Wired-AndroidBypass](https://www.wired.com/2015/09/hack-brief-new-emergency-number-hack-easily-bypasses-android-lock-screens/)
- [Kaspersky-iOSBypass](https://threatpost.com/ios-10-passcode-bypass-can-access-photos-contacts/122033/)
- [TheSun-FaceID](https://www.thesun.co.uk/tech/5584082/iphone-x-face-unlock-tricked-broken/)
- [SRLabs-Fingerprint](https://srlabs.de/bites/spoofing-fingerprints/)
- [MITRE ATT&CK Mobile - T1461](https://attack.mitre.org/techniques/T1461)
