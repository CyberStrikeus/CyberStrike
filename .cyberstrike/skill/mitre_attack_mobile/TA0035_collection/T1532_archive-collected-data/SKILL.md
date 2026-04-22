---
name: "T1532_archive-collected-data"
description: "Adversaries may compress and/or encrypt data that is collected prior to exfiltration."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1532
  - collection
  - android
  - ios
technique_id: "T1532"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1532"
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

# T1532 Archive Collected Data

## High-Level Description

Adversaries may compress and/or encrypt data that is collected prior to exfiltration. Compressing data can help to obfuscate its contents and minimize use of network resources. Encryption can be used to hide information that is being exfiltrated from detection or make exfiltration less conspicuous upon inspection by a defender. 

 

Both compression and encryption are done prior to exfiltration, and can be performed using a utility, programming library, or custom algorithm.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Archive Collected Data technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Archive Collected Data
- [ ] Check iOS devices for indicators of Archive Collected Data
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Archive Collected Data by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1532 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Archive Collected Data


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Archive Collected Data technique applicable | Medium | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [MITRE ATT&CK Mobile - T1532](https://attack.mitre.org/techniques/T1532)
