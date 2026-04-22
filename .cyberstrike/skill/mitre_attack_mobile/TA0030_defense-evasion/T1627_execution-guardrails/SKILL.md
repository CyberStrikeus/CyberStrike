---
name: "T1627_execution-guardrails"
description: "Adversaries may use execution guardrails to constrain execution or actions based on adversary supplied and environment specific conditions that are expected to be present on the target."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1627
  - defense-evasion
  - android
  - ios
technique_id: "T1627"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1627"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1627.001
prerequisites: []
severity_boost:
  T1627.001: "Chain with T1627.001 for deeper attack path"
---

# T1627 Execution Guardrails

## High-Level Description

Adversaries may use execution guardrails to constrain execution or actions based on adversary supplied and environment specific conditions that are expected to be present on the target. Guardrails ensure that a payload only executes against an intended target and reduces collateral damage from an adversary’s campaign. Values an adversary can provide about a target system or environment to use as guardrails may include environment information such as location.

Guardrails can be used to prevent exposure of capabilities in environments that are not intended to be compromised or operated within. This use of guardrails is distinct from typical System Checks. While use of System Checks may involve checking for known sandbox values and continuing with execution only if there is no match, the use of guardrails will involve checking for an expected target-specific value and only continuing with execution if there is such a match.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Execution Guardrails technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Execution Guardrails
- [ ] Check iOS devices for indicators of Execution Guardrails
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Execution Guardrails by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1627 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1006 Use Recent OS Version

New OS releases frequently contain additional limitations or controls around device location access.

### M1011 User Guidance

Users should be advised to be extra scrutinous of applications that request location or sensitive phone information permissions, and to deny any permissions requests for applications they do not recognize.

## Detection

### Detection of Execution Guardrails

## Risk Assessment

| Finding                                   | Severity | Impact          |
| ----------------------------------------- | -------- | --------------- |
| Execution Guardrails technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [SWB Exodus March 2019](https://web.archive.org/web/20200314194610/https://securitywithoutborders.org/blog/2019/03/29/exodus.html)
- [MITRE ATT&CK Mobile - T1627](https://attack.mitre.org/techniques/T1627)
