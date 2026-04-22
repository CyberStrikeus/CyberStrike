---
name: "T1655.001_match-legitimate-name-or-location"
description: "Adversaries may match or approximate the name or location of legitimate files or resources when naming/placing them."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1655.001
  - defense-evasion
  - android
  - ios
  - sub-technique
technique_id: "T1655.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1655/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1655
prerequisites:
  - T1655
severity_boost:
  T1655: "Chain with T1655 for deeper attack path"
---

# T1655.001 Match Legitimate Name or Location

> **Sub-technique of:** T1655

## High-Level Description

Adversaries may match or approximate the name or location of legitimate files or resources when naming/placing them. This is done for the sake of evading defenses and observation. This may be done by giving artifacts the name and icon of a legitimate, trusted application (i.e., Settings), or using a package name that matches legitimate, trusted applications (i.e., `com.google.android.gm`). 

Adversaries may also use the same icon of the file or application they are trying to mimic.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Match Legitimate Name or Location technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Match Legitimate Name or Location
- [ ] Check iOS devices for indicators of Match Legitimate Name or Location
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Match Legitimate Name or Location by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1655.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should be encouraged to only install apps from authorized app stores, which are less likely to contain malicious repackaged apps.


## Detection

### Detection of Match Legitimate Name or Location


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Match Legitimate Name or Location technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-14.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-31.html)
- [MITRE ATT&CK Mobile - T1655.001](https://attack.mitre.org/techniques/T1655/001)
