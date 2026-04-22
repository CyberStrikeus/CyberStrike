---
name: "T1582_sms-control"
description: "Adversaries may delete, alter, or send SMS messages without user authorization."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1582
  - impact
  - android
technique_id: "T1582"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1582"
tech_stack:
  - android
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1582 SMS Control

## High-Level Description

Adversaries may delete, alter, or send SMS messages without user authorization. This could be used to hide C2 SMS messages, spread malware, or various external effects.

This can be accomplished by requesting the `RECEIVE_SMS` or `SEND_SMS` permissions depending on what the malware is attempting to do. If the app is set as the default SMS handler on the device, the `SMS_DELIVER` broadcast intent can be registered, which allows the app to write to the SMS content provider. The content provider directly modifies the messaging database on the device, which could allow malicious applications with this ability to insert, modify, or delete arbitrary messages on the device.

## Kill Chain Phase

- Impact (TA0034)

**Platforms:** Android

## What to Check

- [ ] Identify if SMS Control technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of SMS Control
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to SMS Control by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1582 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

Users should be encouraged to be very careful with what applications they grant SMS access to. Further, users should not change their default SMS handler to applications they do not recognize.

## Detection

### Detection of SMS Control

## Risk Assessment

| Finding                          | Severity | Impact |
| -------------------------------- | -------- | ------ |
| SMS Control technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Android SmsProvider](https://android.googlesource.com/platform/packages/providers/TelephonyProvider/+/7e7c274/src/com/android/providers/telephony/SmsProvider.java)
- [SMS KitKat](https://android-developers.googleblog.com/2013/10/getting-your-sms-apps-ready-for-kitkat.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-16.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-41.html)
- [MITRE ATT&CK Mobile - T1582](https://attack.mitre.org/techniques/T1582)
