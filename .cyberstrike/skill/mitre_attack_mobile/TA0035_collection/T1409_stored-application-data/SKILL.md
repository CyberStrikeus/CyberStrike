---
name: "T1409_stored-application-data"
description: "Adversaries may try to access and collect application data resident on the device."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1409
  - collection
  - android
  - ios
technique_id: "T1409"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1409"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1409 Stored Application Data

## High-Level Description

Adversaries may try to access and collect application data resident on the device. Adversaries often target popular applications, such as Facebook, WeChat, and Gmail.

Due to mobile OS sandboxing, this technique is only possible in three scenarios:

- An application stores files in unprotected external storage
- An application stores files in its internal storage directory with insecure permissions (e.g. 777)
- The adversary gains root permissions on the device

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Stored Application Data technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Stored Application Data
- [ ] Check iOS devices for indicators of Stored Application Data
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Stored Application Data by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1409 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

Android 9 introduced a new security policy that prevents applications from reading or writing data to other applications’ internal storage directories, regardless of permissions.

## Detection

### Detection of Stored Application Data

## Risk Assessment

| Finding                                      | Severity | Impact     |
| -------------------------------------------- | -------- | ---------- |
| Stored Application Data technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [SWB Exodus March 2019](https://web.archive.org/web/20200314194610/https://securitywithoutborders.org/blog/2019/03/29/exodus.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/authentication-threats/AUT-0.html)
- [MITRE ATT&CK Mobile - T1409](https://attack.mitre.org/techniques/T1409)
