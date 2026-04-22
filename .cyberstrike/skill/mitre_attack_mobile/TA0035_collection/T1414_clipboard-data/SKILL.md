---
name: "T1414_clipboard-data"
description: "Adversaries may abuse clipboard manager APIs to obtain sensitive information copied to the device clipboard."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1414
  - collection
  - credential-access
  - android
  - ios
technique_id: "T1414"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1414"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1414 Clipboard Data

## High-Level Description

Adversaries may abuse clipboard manager APIs to obtain sensitive information copied to the device clipboard. For example, passwords being copied and pasted from a password manager application could be captured by a malicious application installed on the device.

On Android, applications can use the `ClipboardManager.OnPrimaryClipChangedListener()` API to register as a listener and monitor the clipboard for changes. However, starting in Android 10, this can only be used if the application is in the foreground, or is set as the device’s default input method editor (IME).

On iOS, this can be accomplished by accessing the `UIPasteboard.general.string` field. However, starting in iOS 14, upon accessing the clipboard, the user will be shown a system notification if the accessed text originated in a different application. For example, if the user copies the text of an iMessage from the Messages application, the notification will read “application_name has pasted from Messages” when the text was pasted in a different application.

## Kill Chain Phase

- Collection (TA0035)
- Credential Access (TA0031)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Clipboard Data technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Clipboard Data
- [ ] Check iOS devices for indicators of Clipboard Data
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Clipboard Data by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1414 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

Android 10 introduced changes to prevent applications from accessing clipboard data if they are not in the foreground or set as the device’s default IME.

## Detection

### Detection of Clipboard Data

## Risk Assessment

| Finding                             | Severity | Impact     |
| ----------------------------------- | -------- | ---------- |
| Clipboard Data technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Android 10 Privacy Changes](https://developer.android.com/about/versions/10/privacy/changes#clipboard-data)
- [UIPPasteboard](https://developer.apple.com/documentation/uikit/uipasteboard)
- [Fahl-Clipboard](https://saschafahl.de/static/paper/pwmanagers2013.pdf)
- [Github Capture Clipboard 2019](https://github.com/grepx/android-clipboard-security)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-35.html)
- [MITRE ATT&CK Mobile - T1414](https://attack.mitre.org/techniques/T1414)
