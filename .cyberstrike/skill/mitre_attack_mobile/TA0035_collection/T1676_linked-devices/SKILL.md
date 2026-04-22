---
name: "T1676_linked-devices"
description: "Adversaries may abuse the “linked devices” feature on messaging applications, such as Signal and WhatsApp, to register the user’s account to an adversary-controlled device."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1676
  - collection
  - persistence
  - android
  - ios
technique_id: "T1676"
tactic: "collection"
all_tactics:
  - collection
  - persistence
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1676"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1676 Linked Devices

## High-Level Description

Adversaries may abuse the “linked devices” feature on messaging applications, such as Signal and WhatsApp, to register the user’s account to an adversary-controlled device. By abusing the “linked devices” feature, adversaries may achieve and maintain persistence through the user’s account, may collect information, such as the user’s messages and contacts list, and may send future messages from the linked device.

Signal is a messaging application that uses the open-source Signal Protocol to encrypt messages and calls; similarly, WhatsApp is a messaging application that has end-to-end encryption and other security measures to protect messages and calls. Both applications have a “linked devices” feature that allows users to access their Signal and/or WhatsApp accounts from different devices, such as a Windows or Mac desktop, an iPad or an Android tablet.

Adversaries may use Phishing techniques to trick the user into scanning a quick-response (QR) code, which is used to link the user’s Signal and/or WhatsApp account to an adversary-controlled device. For example, adversaries may masquerade QR codes as group invites, security alerts or as legitimate instructions for pairing linked devices. 
Upon scanning the QR code in Signal, users may click on the “Transfer Message History” option to sync the linked devices, which may allow adversaries to collect more information about the user. Upon scanning the QR code in WhatsApp, the user’s device will automatically send an end-to-end encrypted copy of recent message history to the adversary-controlled device.

## Kill Chain Phase

- Collection (TA0035)
- Persistence (TA0028)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Linked Devices technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Linked Devices
- [ ] Check iOS devices for indicators of Linked Devices
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Linked Devices by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1676 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
For Android devices, users should be advised to enable Google Play Protect, which checks the device itself and the applications for malicious behavior. For iOS devices, users who are concerned about being targeted should consider enabling Lockdown Mode, which provides extreme protection of the device as well as data stored and transmitted. 
In general, users should be advised against scanning QR codes and/or clicking on suspicious links or text messages, which may masquerade as device-linking instructions by Signal or WhatsApp.


## Detection

### Detection of Linked Devices


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Linked Devices technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Signal_LinkedDevices_NoDate](https://support.signal.org/hc/en-us/articles/360007320551-Linked-Devices)
- [WhatsApp_LinkDevice_NoDate](https://faq.whatsapp.com/1317564962315842/?helpref=faq_content&cms_platform=web)
- [MITRE ATT&CK Mobile - T1676](https://attack.mitre.org/techniques/T1676)
