---
name: "T1628.001_suppress-application-icon"
description: "A malicious application could suppress its icon from being displayed to the user in the application launcher."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1628.001
  - defense-evasion
  - android
  - sub-technique
technique_id: "T1628.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1628/001"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1628
  - T1628.002
  - T1628.003
prerequisites:
  - T1628
severity_boost:
  T1628: "Chain with T1628 for deeper attack path"
  T1628.002: "Chain with T1628.002 for deeper attack path"
  T1628.003: "Chain with T1628.003 for deeper attack path"
---

# T1628.001 Suppress Application Icon

> **Sub-technique of:** T1628

## High-Level Description

A malicious application could suppress its icon from being displayed to the user in the application launcher. This hides the fact that it is installed, and can make it more difficult for the user to uninstall the application. Hiding the application's icon programmatically does not require any special permissions. 

This behavior has been seen in the BankBot/Spy Banker family of malware. 

Beginning in Android 10, changes were introduced to inhibit malicious applications’ ability to hide their icon. If an app is a system app, requests no permissions, or does not have a launcher activity, the application’s icon will be fully hidden. Further, if the device is fully managed or the application is in a work profile, the icon will be fully hidden. Otherwise, a synthesized activity is shown, which is a launcher icon that represents the app’s details page in the system settings. If the user clicks the synthesized activity in the launcher, they are taken to the application’s details page in the system settings.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Suppress Application Icon technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Suppress Application Icon
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Suppress Application Icon by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1628.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
Android 10 introduced changes to prevent malicious applications from fully suppressing their icon in the launcher.

### M1011 User Guidance
Users should be shown what a synthetic activity looks like so they can scrutinize them in the future.


## Detection

### Detection of Suppress Application Icon


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Suppress Application Icon technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Android 10 Limitations to Hiding App Icons](https://source.android.com/setup/start/android-10-release#limitations_to_hiding_app_icons)
- [LauncherApps getActivityList](https://developer.android.com/reference/kotlin/android/content/pm/LauncherApps#getactivitylist)
- [sunny-stolen-credentials](https://www.welivesecurity.com/2017/02/22/sunny-chance-stolen-credentials-malicious-weather-app-found-google-play/)
- [android-trojan-steals-paypal-2fa](https://www.welivesecurity.com/2018/12/11/android-trojan-steals-money-paypal-accounts-2fa/)
- [bankbot-spybanker](https://www.cyber.nj.gov/threat-landscape/malware/trojans/bankbot-spy-banker)
- [MITRE ATT&CK Mobile - T1628.001](https://attack.mitre.org/techniques/T1628/001)
