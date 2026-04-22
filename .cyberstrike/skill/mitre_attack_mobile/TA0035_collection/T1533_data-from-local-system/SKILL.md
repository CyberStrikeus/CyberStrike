---
name: "T1533_data-from-local-system"
description: "Adversaries may search local system sources, such as file systems or local databases, to find files of interest and sensitive data prior to exfiltration."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1533
  - collection
  - android
  - ios
technique_id: "T1533"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1533"
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

# T1533 Data from Local System

## High-Level Description

Adversaries may search local system sources, such as file systems or local databases, to find files of interest and sensitive data prior to exfiltration. 

 

Access to local system data, which includes information stored by the operating system, often requires escalated privileges. Examples of local system data include authentication tokens, the device keyboard cache, Wi-Fi passwords, and photos. On Android, adversaries may also attempt to access files from external storage which may require additional storage-related permissions.

## Kill Chain Phase

- Collection (TA0035)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Data from Local System technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Data from Local System
- [ ] Check iOS devices for indicators of Data from Local System
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Data from Local System by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1533 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Data from Local System


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data from Local System technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/stack-threats/STA-41.html)
- [MITRE ATT&CK Mobile - T1533](https://attack.mitre.org/techniques/T1533)
