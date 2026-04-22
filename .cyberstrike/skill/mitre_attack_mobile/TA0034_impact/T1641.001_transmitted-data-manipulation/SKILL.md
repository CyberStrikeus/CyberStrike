---
name: "T1641.001_transmitted-data-manipulation"
description: "Adversaries may alter data en route to storage or other systems in order to manipulate external outcomes or hide activity."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1641.001
  - impact
  - android
  - sub-technique
technique_id: "T1641.001"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1641/001"
tech_stack:
  - android
cwe_ids:
  - CWE-400
chains_with:
  - T1641
prerequisites:
  - T1641
severity_boost:
  T1641: "Chain with T1641 for deeper attack path"
---

# T1641.001 Transmitted Data Manipulation

> **Sub-technique of:** T1641

## High-Level Description

Adversaries may alter data en route to storage or other systems in order to manipulate external outcomes or hide activity. By manipulating transmitted data, adversaries may attempt to affect a business process, organizational understanding, or decision making.

Manipulation may be possible over a network connection or between system processes where there is an opportunity to deploy a tool that will intercept and change information. The type of modification and the impact it will have depends on the target transmission mechanism as well as the goals and objectives of the adversary. For complex systems, an adversary would likely need special expertise and possibly access to specialized software related to the system, typically gained through a prolonged information gathering campaign, in order to have the desired impact.

One method to achieve Transmitted Data Manipulation is by modifying the contents of the device clipboard. Malicious applications may monitor clipboard activity through the `ClipboardManager.OnPrimaryClipChangedListener` interface on Android to determine when clipboard contents have changed. Listening to clipboard activity, reading clipboard contents, and modifying clipboard contents requires no explicit application permissions and can be performed by applications running in the background. However, this behavior has changed with the release of Android 10.

Adversaries may use Transmitted Data Manipulation to replace text prior to being pasted. For example, replacing a copied Bitcoin wallet address with a wallet address that is under adversarial control.

Transmitted Data Manipulation was seen within the Android/Clipper.C trojan. This sample was detected by ESET in an application distributed through the Google Play Store targeting cryptocurrency wallet numbers.

## Kill Chain Phase

- Impact (TA0034)

**Platforms:** Android

## What to Check

- [ ] Identify if Transmitted Data Manipulation technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Transmitted Data Manipulation
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Transmitted Data Manipulation by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1641.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

Android 10 prevents applications from accessing clipboard data unless the application is on the foreground or is set as the device’s default input method editor (IME).

## Detection

### Detection of Transmitted Data Manipulation

## Risk Assessment

| Finding                                            | Severity | Impact |
| -------------------------------------------------- | -------- | ------ |
| Transmitted Data Manipulation technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [ESET Clipboard Modification February 2019](https://www.eset.com/uk/about/newsroom/press-releases/first-clipper-malware-discovered-on-google-play-1/)
- [MITRE ATT&CK Mobile - T1641.001](https://attack.mitre.org/techniques/T1641/001)
