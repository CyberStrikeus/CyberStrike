---
name: "T1628_hide-artifacts"
description: "Adversaries may attempt to hide artifacts associated with their behaviors to evade detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1628
  - defense-evasion
  - android
technique_id: "T1628"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1628"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1628.001
  - T1628.002
  - T1628.003
prerequisites:
  []
severity_boost:
  T1628.001: "Chain with T1628.001 for deeper attack path"
  T1628.002: "Chain with T1628.002 for deeper attack path"
  T1628.003: "Chain with T1628.003 for deeper attack path"
---

# T1628 Hide Artifacts

## High-Level Description

Adversaries may attempt to hide artifacts associated with their behaviors to evade detection. Mobile operating systems have features and developer APIs to hide various artifacts, such as an application’s launcher icon. These APIs have legitimate usages, such as hiding an icon to avoid application drawer clutter when an application does not have a usable interface. Adversaries may abuse these features and APIs to hide artifacts from the user to evade detection.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Hide Artifacts technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Hide Artifacts
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Hide Artifacts by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1628 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Hide Artifacts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Hide Artifacts technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [MITRE ATT&CK Mobile - T1628](https://attack.mitre.org/techniques/T1628)
