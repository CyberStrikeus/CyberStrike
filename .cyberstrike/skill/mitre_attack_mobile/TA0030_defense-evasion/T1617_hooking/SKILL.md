---
name: "T1617_hooking"
description: "Adversaries may utilize hooking to hide the presence of artifacts associated with their behaviors to evade detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1617
  - defense-evasion
  - android
technique_id: "T1617"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1617"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1617 Hooking

## High-Level Description

Adversaries may utilize hooking to hide the presence of artifacts associated with their behaviors to evade detection. Hooking can be used to modify return values or data structures of system APIs and function calls. This process typically involves using 3rd party root frameworks, such as Xposed or Magisk, with either a system exploit or pre-existing root access. By including custom modules for root frameworks, adversaries can hook system APIs and alter the return value and/or system data structures to alter functionality/visibility of various aspects of the system.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Hooking technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Hooking
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Hooking by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1617 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1002 Attestation
Device attestation can often detect rooted devices.

### M1010 Deploy Compromised Device Detection Method
Mobile security products can often detect rooted devices.


## Detection

### Detection of Hooking


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Hooking technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [MITRE ATT&CK Mobile - T1617](https://attack.mitre.org/techniques/T1617)
