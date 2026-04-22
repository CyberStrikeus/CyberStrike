---
name: "T1636.003_contact-list"
description: "Adversaries may utilize standard operating system APIs to gather contact list data."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1636.003
  - collection
  - android
  - ios
  - sub-technique
technique_id: "T1636.003"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1636/003"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1636
  - T1636.001
  - T1636.002
  - T1636.004
  - T1636.005
prerequisites:
  - T1636
severity_boost:
  T1636: "Chain with T1636 for deeper attack path"
  T1636.001: "Chain with T1636.001 for deeper attack path"
  T1636.002: "Chain with T1636.002 for deeper attack path"
---

# T1636.003 Contact List

> **Sub-technique of:** T1636

## High-Level Description

Adversaries may utilize standard operating system APIs to gather contact list data. On Android, this can be accomplished using the Contacts Content Provider. On iOS, this can be accomplished using the `Contacts` framework. 

 

If the device has been jailbroken or rooted, an adversary may be able to access the Contact List without the user’s knowledge or approval.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Contact List technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Contact List
- [ ] Check iOS devices for indicators of Contact List
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Contact List by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1636.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Contact list access is an uncommonly needed permission, so users should be instructed to use extra scrutiny when granting access to their contact list.


## Detection

### Detection of Contact List


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Contact List technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-13.html)
- [MITRE ATT&CK Mobile - T1636.003](https://attack.mitre.org/techniques/T1636/003)
