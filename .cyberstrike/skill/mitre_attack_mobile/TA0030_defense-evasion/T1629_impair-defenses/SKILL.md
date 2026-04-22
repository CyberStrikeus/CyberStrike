---
name: "T1629_impair-defenses"
description: "Adversaries may maliciously modify components of a victim environment in order to hinder or disable defensive mechanisms."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1629
  - defense-evasion
  - android
technique_id: "T1629"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1629"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1629.001
  - T1629.002
  - T1629.003
prerequisites:
  []
severity_boost:
  T1629.001: "Chain with T1629.001 for deeper attack path"
  T1629.002: "Chain with T1629.002 for deeper attack path"
  T1629.003: "Chain with T1629.003 for deeper attack path"
---

# T1629 Impair Defenses

## High-Level Description

Adversaries may maliciously modify components of a victim environment in order to hinder or disable defensive mechanisms. This not only involves impairing preventative defenses, such as anti-virus, but also detection capabilities that defenders can use to audit activity and identify malicious behavior. This may span both native defenses as well as supplemental capabilities installed by users or mobile endpoint administrators.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Impair Defenses technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Impair Defenses
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Impair Defenses by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1629 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1010 Deploy Compromised Device Detection Method
Mobile security software can typically detect if a device has been rooted or jailbroken and can inform the user, who can then take appropriate action.

### M1001 Security Updates
Security updates often contain patches for vulnerabilities that could be exploited for root access. Root access is often a requirement to impairing defenses.

### M1011 User Guidance
Providing user guidance around commonly abused features, such as the modal that requests for administrator permissions, should aid in preventing impairing defenses.

### M1004 System Partition Integrity
System partition integrity mechanisms, such as Verified Boot, can detect the unauthorized modification of system files.

### M1012 Enterprise Policy
An EMM/MDM can use the Android `DevicePolicyManager.setPermittedAccessibilityServices` method to set an explicit list of applications that are allowed to use Android's accessibility features.


## Detection

### Detection of Impair Defenses


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Impair Defenses technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Samsung Knox Mobile Threat Defense](https://partner.samsungknox.com/mtd)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-22.html)
- [MITRE ATT&CK Mobile - T1629](https://attack.mitre.org/techniques/T1629)
