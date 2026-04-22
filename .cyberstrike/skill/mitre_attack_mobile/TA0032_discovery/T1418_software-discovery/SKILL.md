---
name: "T1418_software-discovery"
description: "Adversaries may attempt to get a listing of applications that are installed on a device."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1418
  - discovery
  - android
  - ios
technique_id: "T1418"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1418"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1418.001
prerequisites:
  []
severity_boost:
  T1418.001: "Chain with T1418.001 for deeper attack path"
---

# T1418 Software Discovery

## High-Level Description

Adversaries may attempt to get a listing of applications that are installed on a device. Adversaries may use the information from Software Discovery during automated discovery to shape follow-on behaviors, including whether or not to fully infect the target and/or attempts specific actions. 

 

Adversaries may attempt to enumerate applications for a variety of reasons, such as figuring out what security measures are present or to identify the presence of target applications.

## Kill Chain Phase

- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Software Discovery technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Software Discovery
- [ ] Check iOS devices for indicators of Software Discovery
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Software Discovery by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1418 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
iOS users should be instructed to not download applications from unofficial sources, as applications distributed via the Apple App Store cannot list installed applications on a device.

### M1006 Use Recent OS Version
Android 11 introduced privacy enhancements to package visibility, filtering results that are returned from the package manager. iOS 12 removed the private API that could previously be used to list installed applications on non-app store applications.


## Detection

### Detection of Software Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Software Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-12.html)
- [MITRE ATT&CK Mobile - T1418](https://attack.mitre.org/techniques/T1418)
