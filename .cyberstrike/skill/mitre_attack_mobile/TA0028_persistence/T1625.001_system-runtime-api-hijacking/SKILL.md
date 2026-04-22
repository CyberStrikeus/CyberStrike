---
name: "T1625.001_system-runtime-api-hijacking"
description: "Adversaries may execute their own malicious payloads by hijacking the way an operating system runs applications."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1625.001
  - persistence
  - android
  - sub-technique
technique_id: "T1625.001"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1625/001"
tech_stack:
  - android
cwe_ids:
  - CWE-276
chains_with:
  - T1625
prerequisites:
  - T1625
severity_boost:
  T1625: "Chain with T1625 for deeper attack path"
---

# T1625.001 System Runtime API Hijacking

> **Sub-technique of:** T1625

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking the way an operating system runs applications. Hijacking execution flow can be for the purposes of persistence since this hijacked execution may reoccur at later points in time. 


On Android, adversaries may overwrite the standard OS API library with a malicious alternative to hook into core functions to achieve persistence. By doing this, the adversary’s code will be executed every time the overwritten API function is called by an app on the infected device.

## Kill Chain Phase

- Persistence (TA0028)

**Platforms:** Android

## What to Check

- [ ] Identify if System Runtime API Hijacking technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of System Runtime API Hijacking
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to System Runtime API Hijacking by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1625.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1002 Attestation
Device attestation could detect unauthorized operating system modifications.

### M1004 System Partition Integrity
Android Verified Boot can detect unauthorized modifications made to the system partition, which could lead to execution flow hijacking.


## Detection

### Detection of System Runtime API Hijacking


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| System Runtime API Hijacking technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-27.html)
- [MITRE ATT&CK Mobile - T1625.001](https://attack.mitre.org/techniques/T1625/001)
