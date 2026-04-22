---
name: "T1636.002_call-log"
description: "Adversaries may utilize standard operating system APIs to gather call log data."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1636.002
  - collection
  - android
  - ios
  - sub-technique
technique_id: "T1636.002"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1636/002"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1636
  - T1636.001
  - T1636.003
  - T1636.004
  - T1636.005
prerequisites:
  - T1636
severity_boost:
  T1636: "Chain with T1636 for deeper attack path"
  T1636.001: "Chain with T1636.001 for deeper attack path"
  T1636.003: "Chain with T1636.003 for deeper attack path"
---

# T1636.002 Call Log

> **Sub-technique of:** T1636

## High-Level Description

Adversaries may utilize standard operating system APIs to gather call log data. On Android, this can be accomplished using the Call Log Content Provider. iOS provides no standard API to access the call log. 

 

If the device has been jailbroken or rooted, an adversary may be able to access the Call Log without the user’s knowledge or approval.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Call Log technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Call Log
- [ ] Check iOS devices for indicators of Call Log
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Call Log by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1636.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Call Log access an uncommonly needed permission, so users should be instructedto use extra scrutiny when granting access to their call logs.


## Detection

### Detection of Call Log


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Call Log technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-13.html)
- [MITRE ATT&CK Mobile - T1636.002](https://attack.mitre.org/techniques/T1636/002)
