---
name: "T1629.003_disable-or-modify-tools"
description: "Adversaries may disable security tools to avoid potential detection of their tools and activities."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1629.003
  - defense-evasion
  - android
  - sub-technique
technique_id: "T1629.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1629/003"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1629
  - T1629.001
  - T1629.002
prerequisites:
  - T1629
severity_boost:
  T1629: "Chain with T1629 for deeper attack path"
  T1629.001: "Chain with T1629.001 for deeper attack path"
  T1629.002: "Chain with T1629.002 for deeper attack path"
---

# T1629.003 Disable or Modify Tools

> **Sub-technique of:** T1629

## High-Level Description

Adversaries may disable security tools to avoid potential detection of their tools and activities. This can take the form of disabling security software, modifying SELinux configuration, or other methods to interfere with security tools scanning or reporting information. This is typically done by abusing device administrator permissions or using system exploits to gain root access to the device to modify protected system files.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Disable or Modify Tools technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Disable or Modify Tools
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Disable or Modify Tools by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1629.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1004 System Partition Integrity
System partition integrity mechanisms, such as Verified Boot, can detect the unauthorized modification of system files.

### M1010 Deploy Compromised Device Detection Method
Mobile security software can typically detect if a device has been rooted or jailbroken and can inform the user, who can then take appropriate action.

### M1011 User Guidance
Users should be taught the dangers of rooting or jailbreaking their device.

### M1001 Security Updates
Security updates frequently contain patches to vulnerabilities that can be exploited for root access.


## Detection

### Detection of Disable or Modify Tools


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Disable or Modify Tools technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [MITRE ATT&CK Mobile - T1629.003](https://attack.mitre.org/techniques/T1629/003)
