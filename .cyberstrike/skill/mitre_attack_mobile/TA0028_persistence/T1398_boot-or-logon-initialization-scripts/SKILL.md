---
name: "T1398_boot-or-logon-initialization-scripts"
description: "Adversaries may use scripts automatically executed at boot or logon initialization to establish persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1398
  - persistence
  - android
  - ios
technique_id: "T1398"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1398"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1398 Boot or Logon Initialization Scripts

## High-Level Description

Adversaries may use scripts automatically executed at boot or logon initialization to establish persistence. Initialization scripts are part of the underlying operating system and are not accessible to the user unless the device has been rooted or jailbroken.

## Kill Chain Phase

- Persistence (TA0028)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Boot or Logon Initialization Scripts technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Boot or Logon Initialization Scripts
- [ ] Check iOS devices for indicators of Boot or Logon Initialization Scripts
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Boot or Logon Initialization Scripts by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1398 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1001 Security Updates

Security updates frequently contain fixes for vulnerabilities that could be leveraged to modify protected operating system files.

### M1004 System Partition Integrity

Android and iOS include system partition integrity mechanisms that could detect unauthorized modifications.

### M1002 Attestation

Device attestation could detect devices with unauthorized or unsafe modifications.

### M1003 Lock Bootloader

A locked bootloader could prevent unauthorized modifications to protected operating system files.

## Detection

### Detection of Boot or Logon Initialization Scripts

## Risk Assessment

| Finding                                                   | Severity | Impact      |
| --------------------------------------------------------- | -------- | ----------- |
| Boot or Logon Initialization Scripts technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Android-VerifiedBoot](https://source.android.com/security/verifiedboot/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-26.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-27.html)
- [MITRE ATT&CK Mobile - T1398](https://attack.mitre.org/techniques/T1398)
