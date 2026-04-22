---
name: "T1630.002_file-deletion"
description: "Adversaries may wipe a device or delete individual files in order to manipulate external outcomes or hide activity."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1630.002
  - defense-evasion
  - android
  - sub-technique
technique_id: "T1630.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1630/002"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1630
  - T1630.001
  - T1630.003
prerequisites:
  - T1630
severity_boost:
  T1630: "Chain with T1630 for deeper attack path"
  T1630.001: "Chain with T1630.001 for deeper attack path"
  T1630.003: "Chain with T1630.003 for deeper attack path"
---

# T1630.002 File Deletion

> **Sub-technique of:** T1630

## High-Level Description

Adversaries may wipe a device or delete individual files in order to manipulate external outcomes or hide activity. An application must have administrator access to fully wipe the device, while individual files may not require special permissions to delete depending on their storage location. 

Stored data could include a variety of file formats, such as Office files, databases, stored emails, and custom file formats. The impact file deletion will have depends on the type of data as well as the goals and objectives of the adversary, but can include deleting update files to evade detection or deleting attacker-specified files for impact.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if File Deletion technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of File Deletion
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to File Deletion by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1630.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance
Users should be trained on what device administrator permission request prompts look like, and how to avoid granting permissions on phishing popups.


## Detection

### Detection of File Deletion


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| File Deletion technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Android DevicePolicyManager 2019](https://developer.android.com/reference/android/app/admin/DevicePolicyManager.html)
- [MITRE ATT&CK Mobile - T1630.002](https://attack.mitre.org/techniques/T1630/002)
