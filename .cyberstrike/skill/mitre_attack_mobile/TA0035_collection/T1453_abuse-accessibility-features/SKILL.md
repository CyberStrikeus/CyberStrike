---
name: "T1453_abuse-accessibility-features"
description: "Adversaries may abuse accessibility features in Android devices to steal sensitive data and to spread malware to other devices."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1453
  - collection
  - credential-access
  - android
technique_id: "T1453"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1453"
tech_stack:
  - android
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1453 Abuse Accessibility Features

## High-Level Description

Adversaries may abuse accessibility features in Android devices to steal sensitive data and to spread malware to other devices. Accessibility features in Android are designed to assist users with disabilities, performing a variety of tasks, such as using Action Blocks to control lightbulbs, and changing the device’s user interface, such as changing the font size and adjusting contract or colors.

One example of how adversaries abuse accessibility features is overlaying an HTML object mimicking a legitimate login screen. The user types their credentials in the overlay HTML object, which is then sent to the adversaries.

Another example is a malicious accessibility feature acting as a keylogger. The keylogger monitors changes on the EditText fields and sends it to the adversaries. This method of attack is also described in Keylogging; whereas Abuse Accessibility Features captures the overall abuse of accessibility features.

## Kill Chain Phase

- Collection (TA0035)
- Credential Access (TA0031)

**Platforms:** Android

## What to Check

- [ ] Identify if Abuse Accessibility Features technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Abuse Accessibility Features
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Abuse Accessibility Features by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1453 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

First, users should be wary of clicking on suspicious text messages, links and emails. Secondly, users should be wary of granting applications accessibility features. Users may check applications that have been granted accessibility features by going to Settings, then Accessibility. Finally, users should be wary of downloading applications; although applications may be on the Google Play Store, they may not be benign (see Application Versioning).

## Detection

### Detection of Abuse Accessibility Features

## Risk Assessment

| Finding                                           | Severity | Impact     |
| ------------------------------------------------- | -------- | ---------- |
| Abuse Accessibility Features technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Google_AndroidAcsOverview](https://support.google.com/accessibility/android/answer/6006564?hl=en&ref_topic=6007234&sjid=9936713164149272548-NA)
- [SahinSRLabs_FluBot_Dec2021](https://www.srlabs.de/blog-post/flubot-abuses-accessibility-features-to-steal-data)
- [MITRE ATT&CK Mobile - T1453](https://attack.mitre.org/techniques/T1453)
