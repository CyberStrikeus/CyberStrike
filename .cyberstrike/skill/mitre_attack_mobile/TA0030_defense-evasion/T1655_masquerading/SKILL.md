---
name: "T1655_masquerading"
description: "Adversaries may attempt to manipulate features of their artifacts to make them appear legitimate or benign to users and/or security tools."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1655
  - defense-evasion
  - android
  - ios
technique_id: "T1655"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1655"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1655.001
prerequisites: []
severity_boost:
  T1655.001: "Chain with T1655.001 for deeper attack path"
---

# T1655 Masquerading

## High-Level Description

Adversaries may attempt to manipulate features of their artifacts to make them appear legitimate or benign to users and/or security tools. Masquerading occurs when the name, location, or appearance of an object, legitimate or malicious, is manipulated or abused for the sake of evading defenses and observation. This may include manipulating file metadata, tricking users into misidentifying the file type, and giving legitimate task or service names.

Renaming abusable system utilities to evade security monitoring is also a form of Masquerading

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Masquerading technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Masquerading
- [ ] Check iOS devices for indicators of Masquerading
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Masquerading by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1655 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

Users should be encouraged to only install apps from authorized app stores, which are less likely to contain malicious repackaged apps.

## Detection

### Detection of Masquerading

## Risk Assessment

| Finding                           | Severity | Impact          |
| --------------------------------- | -------- | --------------- |
| Masquerading technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-14.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-31.html)
- [MITRE ATT&CK Mobile - T1655](https://attack.mitre.org/techniques/T1655)
