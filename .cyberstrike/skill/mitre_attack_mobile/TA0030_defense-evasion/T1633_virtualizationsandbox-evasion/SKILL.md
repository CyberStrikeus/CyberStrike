---
name: "T1633_virtualizationsandbox-evasion"
description: "Adversaries may employ various means to detect and avoid virtualization and analysis environments."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1633
  - defense-evasion
  - android
  - ios
technique_id: "T1633"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1633"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1633.001
prerequisites: []
severity_boost:
  T1633.001: "Chain with T1633.001 for deeper attack path"
---

# T1633 Virtualization/Sandbox Evasion

## High-Level Description

Adversaries may employ various means to detect and avoid virtualization and analysis environments. This may include changing behaviors after checking for the presence of artifacts indicative of a virtual machine environment (VME) or sandbox. If the adversary detects a VME, they may alter their malware’s behavior to disengage from the victim or conceal the core functions of the payload. They may also search for VME artifacts before dropping further payloads. Adversaries may use the information learned from Virtualization/Sandbox Evasion during automated discovery to shape follow-on behaviors.

Adversaries may use several methods to accomplish Virtualization/Sandbox Evasion such as checking for system artifacts associated with analysis or virtualization. Adversaries may also check for legitimate user activity to help determine if it is in an analysis environment.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Virtualization/Sandbox Evasion technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Virtualization/Sandbox Evasion
- [ ] Check iOS devices for indicators of Virtualization/Sandbox Evasion
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Virtualization/Sandbox Evasion by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1633 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Virtualization/Sandbox Evasion

## Risk Assessment

| Finding                                             | Severity | Impact          |
| --------------------------------------------------- | -------- | --------------- |
| Virtualization/Sandbox Evasion technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [MITRE ATT&CK Mobile - T1633](https://attack.mitre.org/techniques/T1633)
