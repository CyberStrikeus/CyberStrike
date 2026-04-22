---
name: "T1636.001_calendar-entries"
description: "Adversaries may utilize standard operating system APIs to gather calendar entry data."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1636.001
  - collection
  - android
  - ios
  - sub-technique
technique_id: "T1636.001"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1636/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1636
  - T1636.002
  - T1636.003
  - T1636.004
  - T1636.005
prerequisites:
  - T1636
severity_boost:
  T1636: "Chain with T1636 for deeper attack path"
  T1636.002: "Chain with T1636.002 for deeper attack path"
  T1636.003: "Chain with T1636.003 for deeper attack path"
---

# T1636.001 Calendar Entries

> **Sub-technique of:** T1636

## High-Level Description

Adversaries may utilize standard operating system APIs to gather calendar entry data. On Android, this can be accomplished using the Calendar Content Provider. On iOS, this can be accomplished using the `EventKit` framework.

If the device has been jailbroken or rooted, an adversary may be able to access Calendar Entries without the user’s knowledge or approval.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Calendar Entries technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Calendar Entries
- [ ] Check iOS devices for indicators of Calendar Entries
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Calendar Entries by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1636.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

Calendar access is an uncommonly needed permission, so users should be instructed to use extra scrutiny when granting access to their device calendar.

## Detection

### Detection of Calendar Entries

## Risk Assessment

| Finding                               | Severity | Impact     |
| ------------------------------------- | -------- | ---------- |
| Calendar Entries technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-13.html)
- [MITRE ATT&CK Mobile - T1636.001](https://attack.mitre.org/techniques/T1636/001)
