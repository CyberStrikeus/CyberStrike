---
name: "T1625_hijack-execution-flow"
description: "Adversaries may execute their own malicious payloads by hijacking the way operating systems run applications."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1625
  - persistence
  - android
technique_id: "T1625"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1625"
tech_stack:
  - android
cwe_ids:
  - CWE-276
chains_with:
  - T1625.001
prerequisites:
  []
severity_boost:
  T1625.001: "Chain with T1625.001 for deeper attack path"
---

# T1625 Hijack Execution Flow

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking the way operating systems run applications. Hijacking execution flow can be for the purposes of persistence since this hijacked execution may reoccur over time. 

There are many ways an adversary may hijack the flow of execution. A primary way is by manipulating how the operating system locates programs to be executed. How the operating system locates libraries to be used by a program can also be intercepted. Locations where the operating system looks for programs or resources, such as file directories, could also be poisoned to include malicious payloads.

## Kill Chain Phase

- Persistence (TA0028)

**Platforms:** Android

## What to Check

- [ ] Identify if Hijack Execution Flow technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Hijack Execution Flow
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Hijack Execution Flow by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1625 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1004 System Partition Integrity
Android Verified Boot can detect unauthorized modifications made to the system partition, which could lead to execution flow hijacking.

### M1002 Attestation
Device attestation could detect unauthorized operating system modifications.


## Detection

### Detection of Hijack Execution Flow


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Hijack Execution Flow technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-27.html)
- [MITRE ATT&CK Mobile - T1625](https://attack.mitre.org/techniques/T1625)
