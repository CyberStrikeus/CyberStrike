---
name: "T1430.001_remote-device-management-services"
description: "An adversary may use access to cloud services (e.g."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1430.001
  - collection
  - discovery
  - android
  - ios
  - sub-technique
technique_id: "T1430.001"
tactic: "collection"
all_tactics:
  - collection
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1430/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1430
  - T1430.002
prerequisites:
  - T1430
severity_boost:
  T1430: "Chain with T1430 for deeper attack path"
  T1430.002: "Chain with T1430.002 for deeper attack path"
---

# T1430.001 Remote Device Management Services

> **Sub-technique of:** T1430

## High-Level Description

An adversary may use access to cloud services (e.g. Google's Android Device Manager or Apple iCloud's Find my iPhone) or to an enterprise mobility management (EMM)/mobile device management (MDM) server console to track the location of mobile devices managed by the service.

## Kill Chain Phase

- Collection (TA0035)
- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Remote Device Management Services technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Remote Device Management Services
- [ ] Check iOS devices for indicators of Remote Device Management Services
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Remote Device Management Services by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1430.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should protect their account credentials and enable multi-factor authentication options when available.

### M1012 Enterprise Policy
If devices are enrolled using Apple User Enrollment or using a profile owner enrollment mode for Android, device controls prevent the enterprise from accessing the device’s physical location. This is typically used for a Bring Your Own Device (BYOD) deployment.


## Detection

### Detection of Remote Device Management Services


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote Device Management Services technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Krebs-Location](https://krebsonsecurity.com/2018/05/tracking-firm-locationsmart-leaked-location-data-for-customers-of-all-major-u-s-mobile-carriers-in-real-time-via-its-web-site/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/ecosystem-threats/ECO-5.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/emm-threats/EMM-7.html)
- [MITRE ATT&CK Mobile - T1430.001](https://attack.mitre.org/techniques/T1430/001)
