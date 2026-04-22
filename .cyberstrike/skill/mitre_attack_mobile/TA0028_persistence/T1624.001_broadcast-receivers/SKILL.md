---
name: "T1624.001_broadcast-receivers"
description: "Adversaries may establish persistence using system mechanisms that trigger execution based on specific events."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1624.001
  - persistence
  - android
  - sub-technique
technique_id: "T1624.001"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1624/001"
tech_stack:
  - android
cwe_ids:
  - CWE-276
chains_with:
  - T1624
prerequisites:
  - T1624
severity_boost:
  T1624: "Chain with T1624 for deeper attack path"
---

# T1624.001 Broadcast Receivers

> **Sub-technique of:** T1624

## High-Level Description

Adversaries may establish persistence using system mechanisms that trigger execution based on specific events. Mobile operating systems have means to subscribe to events such as receiving an SMS message, device boot completion, or other device activities. 

An intent is a message passed between Android applications or system components. Applications can register to receive broadcast intents at runtime, which are system-wide intents delivered to each app when certain events happen on the device, such as network changes or the user unlocking the screen. Malicious applications can then trigger certain actions within the app based on which broadcast intent was received. 

In addition to Android system intents, malicious applications can register for intents broadcasted by other applications. This allows the malware to respond based on actions in other applications. This behavior typically indicates a more intimate knowledge, or potentially the targeting of specific devices, users, or applications. 

In Android 8 (API level 26), broadcast intent behavior was changed, limiting the implicit intents that applications can register for in the manifest. In most cases, applications that register through the manifest will no longer receive the broadcasts. Now, applications must register context-specific broadcast receivers while the user is actively using the app.

## Kill Chain Phase

- Persistence (TA0028)

**Platforms:** Android

## What to Check

- [ ] Identify if Broadcast Receivers technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Broadcast Receivers
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Broadcast Receivers by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1624.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
Android 8 introduced additional limitations on the implicit intents that an application can register for.


## Detection

### Detection of Broadcast Receivers


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Broadcast Receivers technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Android Changes to System Broadcasts](https://developer.android.com/guide/components/broadcasts#changes-system-broadcasts)
- [MITRE ATT&CK Mobile - T1624.001](https://attack.mitre.org/techniques/T1624/001)
