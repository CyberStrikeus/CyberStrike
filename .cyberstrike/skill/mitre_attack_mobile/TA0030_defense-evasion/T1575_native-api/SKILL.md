---
name: "T1575_native-api"
description: "Adversaries may use Android’s Native Development Kit (NDK) to write native functions that can achieve execution of binaries or functions."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1575
  - defense-evasion
  - execution
  - android
technique_id: "T1575"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - execution
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1575"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1575 Native API

## High-Level Description

Adversaries may use Android’s Native Development Kit (NDK) to write native functions that can achieve execution of binaries or functions. Like system calls on a traditional desktop operating system, native code achieves execution on a lower level than normal Android SDK calls.

The NDK allows developers to write native code in C or C++ that is compiled directly to machine code, avoiding all intermediate languages and steps in compilation that higher level languages, like Java, typically have. The Java Native Interface (JNI) is the component that allows Java functions in the Android app to call functions in a native library.

Adversaries may also choose to use native functions to execute malicious code since native actions are typically much more difficult to analyze than standard, non-native behaviors.

## Kill Chain Phase

- Defense Evasion (TA0030)
- Execution (TA0041)

**Platforms:** Android

## What to Check

- [ ] Identify if Native API technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Native API
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Native API by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1575 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Native API

## Risk Assessment

| Finding                         | Severity | Impact          |
| ------------------------------- | -------- | --------------- |
| Native API technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Google NDK Getting Started](https://developer.android.com/ndk/guides)
- [MITRE App Vetting Effectiveness](https://www.mitre.org/sites/default/files/publications/pr-16-4772-analyzing-effectiveness-mobile-app-vetting-tools-report.pdf)
- [MITRE ATT&CK Mobile - T1575](https://attack.mitre.org/techniques/T1575)
