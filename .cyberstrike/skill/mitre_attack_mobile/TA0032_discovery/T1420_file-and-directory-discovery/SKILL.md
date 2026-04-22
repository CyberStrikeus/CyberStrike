---
name: "T1420_file-and-directory-discovery"
description: "Adversaries may enumerate files and directories or search in specific device locations for desired information within a filesystem."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1420
  - discovery
  - android
  - ios
technique_id: "T1420"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1420"
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

# T1420 File and Directory Discovery

## High-Level Description

Adversaries may enumerate files and directories or search in specific device locations for desired information within a filesystem. Adversaries may use the information from File and Directory Discovery during automated discovery to shape follow-on behaviors, including deciding if the adversary should fully infect the target and/or attempt specific actions. 

On Android, Linux file permissions and SELinux policies typically stringently restrict what can be accessed by apps without taking advantage of a privilege escalation exploit. The contents of the external storage directory are generally visible, which could present concerns if sensitive data is inappropriately stored there. iOS's security architecture generally restricts the ability to perform any type of File and Directory Discovery without use of escalated privileges.

## Kill Chain Phase

- Discovery (TA0032)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if File and Directory Discovery technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of File and Directory Discovery
- [ ] Check iOS devices for indicators of File and Directory Discovery
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to File and Directory Discovery by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1420 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version
Security architecture improvements in each new version of Android and iOS make it more difficult to escalate privileges. Additionally, newer versions of Android have strengthened the sandboxing applied to applications, restricting their ability to enumerate file system contents.


## Detection

### Detection of File and Directory Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| File and Directory Discovery technique applicable | High | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/stack-threats/STA-41.html)
- [MITRE ATT&CK Mobile - T1420](https://attack.mitre.org/techniques/T1420)
