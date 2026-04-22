---
name: "T1426_system-information-discovery"
description: "Adversaries may attempt to get detailed information about a device’s operating system and hardware, including versions, patches, and architecture."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1426
  - discovery
  - android
  - ios
technique_id: "T1426"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1426"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1426 System Information Discovery

## High-Level Description

Adversaries may attempt to get detailed information about a device’s operating system and hardware, including versions, patches, and architecture. Adversaries may use the information from System Information Discovery during automated discovery to shape follow-on behaviors, including whether or not to fully infects the target and/or attempts specific actions.

On Android, much of this information is programmatically accessible to applications through the `android.os.Build` class. iOS is much more restrictive with what information is visible to applications. Typically, applications will only be able to query the device model and which version of iOS it is running.

## Kill Chain Phase

- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if System Information Discovery technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of System Information Discovery
- [ ] Check iOS devices for indicators of System Information Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to System Information Discovery by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1426 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of System Information Discovery

## Risk Assessment

| Finding                                           | Severity | Impact    |
| ------------------------------------------------- | -------- | --------- |
| System Information Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Android-Build](https://developer.android.com/reference/android/os/Build)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-12.html)
- [MITRE ATT&CK Mobile - T1426](https://attack.mitre.org/techniques/T1426)
