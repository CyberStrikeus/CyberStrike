---
name: "T1631_process-injection"
description: "Adversaries may inject code into processes in order to evade process-based defenses or even elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1631
  - defense-evasion
  - privilege-escalation
  - android
  - ios
technique_id: "T1631"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1631"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1631.001
prerequisites:
  []
severity_boost:
  T1631.001: "Chain with T1631.001 for deeper attack path"
---

# T1631 Process Injection

## High-Level Description

Adversaries may inject code into processes in order to evade process-based defenses or even elevate privileges. Process injection is a method of executing arbitrary code in the address space of a separate live process. Running code in the context of another process may allow access to the process's memory, system/network resources, and possibly elevated privileges. Execution via process injection may also evade detection from security products since the execution is masked under a legitimate process. 

Both Android and iOS have no legitimate way to achieve process injection. The only way this is possible is by abusing existing root access or exploiting a vulnerability.

## Kill Chain Phase

- Defense Evasion (TA0030)
- Privilege Escalation (TA0029)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Process Injection technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Process Injection
- [ ] Check iOS devices for indicators of Process Injection
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Process Injection by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1631 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Process Injection


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Process Injection technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [MITRE ATT&CK Mobile - T1631](https://attack.mitre.org/techniques/T1631)
