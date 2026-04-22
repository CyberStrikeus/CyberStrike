---
name: "T1424_process-discovery"
description: "Adversaries may attempt to get information about running processes on a device."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1424
  - discovery
  - android
  - ios
technique_id: "T1424"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1424"
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

# T1424 Process Discovery

## High-Level Description

Adversaries may attempt to get information about running processes on a device. Information obtained could be used to gain an understanding of common software/applications running on devices within a network. Adversaries may use the information from Process Discovery during automated discovery to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions. 

 

Recent Android security enhancements have made it more difficult to obtain a list of running processes. On Android 7 and later, there is no way for an application to obtain the process list without abusing elevated privileges. This is due to the Android kernel utilizing the `hidepid` mount feature. Prior to Android 7, applications could utilize the `ps` command or examine the `/proc` directory on the device. 

 

In iOS, applications have previously been able to use the `sysctl` command to obtain a list of running processes. This functionality has been removed in later iOS versions.

## Kill Chain Phase

- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Process Discovery technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Process Discovery
- [ ] Check iOS devices for indicators of Process Discovery
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Process Discovery by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1424 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
Android 7 and later iOS versions introduced changes that prevent applications from performing Process Discovery without elevated privileges.

### M1002 Attestation
Attestation can typically detect rooted devices. For MDM-enrolled devices, action can be taken if a device fails an attestation check.


## Detection

### Detection of Process Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Process Discovery technique applicable | High | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Android-SELinuxChanges](https://code.google.com/p/android/issues/detail?id=205565)
- [MITRE ATT&CK Mobile - T1424](https://attack.mitre.org/techniques/T1424)
