---
name: "T1640_account-access-removal"
description: "Adversaries may interrupt availability of system and network resources by inhibiting access to accounts utilized by legitimate users."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1640
  - impact
  - android
technique_id: "T1640"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1640"
tech_stack:
  - android
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1640 Account Access Removal

## High-Level Description

Adversaries may interrupt availability of system and network resources by inhibiting access to accounts utilized by legitimate users. Accounts may be deleted, locked, or manipulated (ex: credentials changed) to remove access to accounts.

## Kill Chain Phase

- Impact (TA0034)

**Platforms:** Android

## What to Check

- [ ] Identify if Account Access Removal technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Account Access Removal
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Account Access Removal by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1640 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should be taught that Device Administrator permissions are very dangerous, and very few applications need it.


## Detection

### Detection of Account Access Removal


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Account Access Removal technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [MITRE ATT&CK Mobile - T1640](https://attack.mitre.org/techniques/T1640)
