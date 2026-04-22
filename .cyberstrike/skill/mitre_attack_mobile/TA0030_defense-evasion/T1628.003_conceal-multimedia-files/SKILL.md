---
name: "T1628.003_conceal-multimedia-files"
description: "Adversaries may attempt to hide multimedia files from the user."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1628.003
  - defense-evasion
  - android
  - sub-technique
technique_id: "T1628.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1628/003"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1628
  - T1628.001
  - T1628.002
prerequisites:
  - T1628
severity_boost:
  T1628: "Chain with T1628 for deeper attack path"
  T1628.001: "Chain with T1628.001 for deeper attack path"
  T1628.002: "Chain with T1628.002 for deeper attack path"
---

# T1628.003 Conceal Multimedia Files

> **Sub-technique of:** T1628

## High-Level Description

Adversaries may attempt to hide multimedia files from the user. By doing so, adversaries may conceal captured files, such as pictures, videos and/or screenshots, then later exfiltrate those files. 

Specific to Android devices, if the `.nomedia` file is present in a folder, multimedia files in that folder will not be visible to the user in the Gallery application. Additionally, other applications are asked not to scan the folder with the `.nomedia` file, effectively making the folder appear invisible to the user. 

This technique is often used by stalkerware and spyware applications.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Conceal Multimedia Files technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Conceal Multimedia Files
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Conceal Multimedia Files by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1628.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1059 Do Not Mitigate
Conceal Multimedia Files likely should not be mitigated with preventative controls because the `.nomedia` file may be used legitimately.


## Detection

### Detection of Conceal Multimedia Files


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Conceal Multimedia Files technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [MITRE ATT&CK Mobile - T1628.003](https://attack.mitre.org/techniques/T1628/003)
