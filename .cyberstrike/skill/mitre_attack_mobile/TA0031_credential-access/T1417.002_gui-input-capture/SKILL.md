---
name: "T1417.002_gui-input-capture"
description: "Adversaries may mimic common operating system GUI components to prompt users for sensitive information with a seemingly legitimate prompt."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1417.002
  - credential-access
  - collection
  - android
  - ios
  - sub-technique
technique_id: "T1417.002"
tactic: "credential-access"
all_tactics:
  - credential-access
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1417/002"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-522
chains_with:
  - T1417
  - T1417.001
prerequisites:
  - T1417
severity_boost:
  T1417: "Chain with T1417 for deeper attack path"
  T1417.001: "Chain with T1417.001 for deeper attack path"
---

# T1417.002 GUI Input Capture

> **Sub-technique of:** T1417

## High-Level Description

Adversaries may mimic common operating system GUI components to prompt users for sensitive information with a seemingly legitimate prompt. The operating system and installed applications often have legitimate needs to prompt the user for sensitive information such as account credentials, bank account information, or Personally Identifiable Information (PII). Compared to traditional PCs, the constrained display size of mobile devices may impair the ability to provide users with contextual information, making users more susceptible to this technique’s use.

There are several approaches adversaries may use to mimic this functionality. Adversaries may impersonate the identity of a legitimate application (e.g. use the same application name and/or icon) and, when installed on the device, may prompt the user for sensitive information. Adversaries may also send fake device notifications to the user that may trigger the display of an input prompt when clicked. 

Additionally, adversaries may display a prompt on top of a running, legitimate application to trick users into entering sensitive information into a malicious application rather than the legitimate application. Typically, adversaries need to know when the targeted application and the individual activity within the targeted application is running in the foreground to display the prompt at the proper time. Adversaries can abuse Android’s accessibility features to determine which application is currently in the foreground. Two known approaches to displaying a prompt include:

* Adversaries start a new activity on top of a running legitimate application. Android 10 places new restrictions on the ability for an application to start a new activity on top of another application, which may make it more difficult for adversaries to utilize this technique.
* Adversaries create an application overlay window on top of a running legitimate application. Applications must hold the `SYSTEM_ALERT_WINDOW` permission to create overlay windows. This permission is handled differently than typical Android permissions and, at least under certain conditions, is automatically granted to applications installed from the Google Play Store. The `SYSTEM_ALERT_WINDOW` permission and its associated ability to create application overlay windows are expected to be deprecated in a future release of Android in favor of a new API.

## Kill Chain Phase

- Credential Access (TA0031)
- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if GUI Input Capture technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of GUI Input Capture
- [ ] Check iOS devices for indicators of GUI Input Capture
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to GUI Input Capture by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1417.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
The `HIDE_OVERLAY_WINDOWS` permission was introduced in Android 12 allowing apps to hide overlay windows of type `TYPE_APPLICATION_OVERLAY` drawn by other apps with the `SYSTEM_ALERT_WINDOW` permission, preventing other applications from creating overlay windows on top of the current application.

### M1012 Enterprise Policy
An EMM/MDM can use the Android `DevicePolicyManager.setPermittedAccessibilityServices` method to set an explicit list of applications that are allowed to use Android's accessibility features.


## Detection

### Detection of GUI Input Capture


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| GUI Input Capture technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Felt-PhishingOnMobileDevices](http://w2spconf.com/2011/papers/felt-mobilephishing.pdf)
- [Android Background](https://developer.android.com/guide/components/activities/background-starts)
- [Cloak and Dagger](https://cloak-and-dagger.org/)
- [Group IB Gustuff Mar 2019](https://www.group-ib.com/blog/gustuff)
- [eset-finance](https://www.welivesecurity.com/2018/09/19/fake-finance-apps-google-play-target-around-world/)
- [Hassell-ExploitingAndroid](https://conference.hitb.org/hitbsecconf2011kul/materials/D1T1%20-%20Riley%20Hassell%20-%20Exploiting%20Androids%20for%20Fun%20and%20Profit.pdf)
- [XDA Bubbles](https://www.xda-developers.com/android-q-system-alert-window-deprecate-bubbles/)
- [NowSecure Android Overlay](https://www.nowsecure.com/blog/2017/05/25/android-overlay-malware-system-alert-window-permission/)
- [ThreatFabric Cerberus](https://www.threatfabric.com/blogs/cerberus-a-new-banking-trojan-from-the-underworld.html)
- [Skycure-Accessibility](https://web.archive.org/web/20170211204349/https://www.skycure.com/blog/accessibility-clickjacking/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-31.html)
- [MITRE ATT&CK Mobile - T1417.002](https://attack.mitre.org/techniques/T1417/002)
