---
name: "T1645_compromise-client-software-binary"
description: "Adversaries may modify system software binaries to establish persistent access to devices."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1645
  - persistence
  - android
  - ios
technique_id: "T1645"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1645"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-276
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1645 Compromise Client Software Binary

## High-Level Description

Adversaries may modify system software binaries to establish persistent access to devices. System software binaries are used by the underlying operating system and users over adb or terminal emulators. 

Adversaries may make modifications to client software binaries to carry out malicious tasks when those binaries are executed. For example, malware may come with a pre-compiled malicious binary intended to overwrite the genuine one on the device. Since these binaries may be routinely executed by the system or user, the adversary can leverage this for persistent access to the device.

## Kill Chain Phase

- Persistence (TA0028)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Compromise Client Software Binary technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Compromise Client Software Binary
- [ ] Check iOS devices for indicators of Compromise Client Software Binary
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Compromise Client Software Binary by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1645 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1003 Lock Bootloader
A locked bootloader could prevent unauthorized modifications of protected operating system files.

### M1004 System Partition Integrity
Android includes system partition integrity mechanisms that could detect unauthorized modifications.

### M1001 Security Updates
Security updates frequently contain fixes for vulnerabilities that could be leveraged to modify protected operating system files.

### M1002 Attestation
Device attestation could detect devices with unauthorized or unsafe modifications.


## Detection

### Detection of Compromise Client Software Binary


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compromise Client Software Binary technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Android-VerifiedBoot](https://source.android.com/security/verifiedboot/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-27.html)
- [MITRE ATT&CK Mobile - T1645](https://attack.mitre.org/techniques/T1645)
