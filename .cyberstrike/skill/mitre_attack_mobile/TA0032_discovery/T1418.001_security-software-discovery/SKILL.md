---
name: "T1418.001_security-software-discovery"
description: "Adversaries may attempt to get a listing of security applications and configurations that are installed on a device."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1418.001
  - discovery
  - android
  - ios
  - sub-technique
technique_id: "T1418.001"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1418/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1418
prerequisites:
  - T1418
severity_boost:
  T1418: "Chain with T1418 for deeper attack path"
---

# T1418.001 Security Software Discovery

> **Sub-technique of:** T1418

## High-Level Description

Adversaries may attempt to get a listing of security applications and configurations that are installed on a device. This may include things such as mobile security products. Adversaries may use the information from Security Software Discovery during automated discovery to shape follow-on behaviors, including whether or not to fully infect the target and/or attempt specific actions.

## Kill Chain Phase

- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Security Software Discovery technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Security Software Discovery
- [ ] Check iOS devices for indicators of Security Software Discovery
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Security Software Discovery by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1418.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

iOS users should be instructed to not download applications from unofficial sources, as applications distributed via the Apple App Store cannot list installed applications on a device.

### M1006 Use Recent OS Version

Android 11 introduced privacy enhancements to package visibility, filtering results that are returned from the package manager. iOS 12 removed the private API that could previously be used to list installed applications on non-app store applications.

## Detection

### Detection of Security Software Discovery

## Risk Assessment

| Finding                                          | Severity | Impact    |
| ------------------------------------------------ | -------- | --------- |
| Security Software Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-12.html)
- [MITRE ATT&CK Mobile - T1418.001](https://attack.mitre.org/techniques/T1418/001)
