---
name: "T1636_protected-user-data"
description: "Adversaries may utilize standard operating system APIs to collect data from permission-backed data stores on a device, such as the calendar or contact list."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1636
  - collection
  - android
  - ios
technique_id: "T1636"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1636"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1636.001
  - T1636.002
  - T1636.003
  - T1636.004
  - T1636.005
prerequisites: []
severity_boost:
  T1636.001: "Chain with T1636.001 for deeper attack path"
  T1636.002: "Chain with T1636.002 for deeper attack path"
  T1636.003: "Chain with T1636.003 for deeper attack path"
---

# T1636 Protected User Data

## High-Level Description

Adversaries may utilize standard operating system APIs to collect data from permission-backed data stores on a device, such as the calendar or contact list. These permissions need to be declared ahead of time. On Android, they must be included in the application’s manifest. On iOS, they must be included in the application’s `Info.plist` file.

In almost all cases, the user is required to grant access to the data store that the application is trying to access. In recent OS versions, vendors have introduced additional privacy controls for users, such as the ability to grant permission to an application only while the application is being actively used by the user.

If the device has been jailbroken or rooted, an adversary may be able to access Protected User Data without the user’s knowledge or approval.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Protected User Data technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Protected User Data
- [ ] Check iOS devices for indicators of Protected User Data
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Protected User Data by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1636 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

OS feature updates often enhance security and privacy around permissions.

### M1011 User Guidance

Users should be taught the danger behind granting unnecessary permissions to an application and should be advised to use extra scrutiny when an application requests them.

## Detection

### Detection of Protected User Data

## Risk Assessment

| Finding                                  | Severity | Impact     |
| ---------------------------------------- | -------- | ---------- |
| Protected User Data technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-13.html)
- [MITRE ATT&CK Mobile - T1636](https://attack.mitre.org/techniques/T1636)
