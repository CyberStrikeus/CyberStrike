---
name: "T1623_command-and-scripting-interpreter"
description: "Adversaries may abuse command and script interpreters to execute commands, scripts, or binaries."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1623
  - execution
  - android
  - ios
technique_id: "T1623"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1623"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-94
chains_with:
  - T1623.001
prerequisites: []
severity_boost:
  T1623.001: "Chain with T1623.001 for deeper attack path"
---

# T1623 Command and Scripting Interpreter

## High-Level Description

Adversaries may abuse command and script interpreters to execute commands, scripts, or binaries. These interfaces and languages provide ways of interacting with computer systems and are a common feature across many different platforms. Most systems come with some built-in command-line interface and scripting capabilities, for example, Android is a UNIX-like OS and includes a basic Unix Shell that can be accessed via the Android Debug Bridge (ADB) or Java’s `Runtime` package.

Adversaries may abuse these technologies in various ways as a means of executing arbitrary commands. Commands and scripts can be embedded in Initial Access payloads delivered to victims as lure documents or as secondary payloads downloaded from an existing C2. Adversaries may also execute commands through interactive terminals/shells.

## Kill Chain Phase

- Execution (TA0041)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Command and Scripting Interpreter technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Command and Scripting Interpreter
- [ ] Check iOS devices for indicators of Command and Scripting Interpreter
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Command and Scripting Interpreter by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1623 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1010 Deploy Compromised Device Detection Method

Mobile security products can typically detect jailbroken or rooted devices.

### M1002 Attestation

Device attestation can often detect jailbroken or rooted devices.

## Detection

### Detection of Command and Scripting Interpreter

## Risk Assessment

| Finding                                                | Severity | Impact    |
| ------------------------------------------------------ | -------- | --------- |
| Command and Scripting Interpreter technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Samsung Knox Mobile Threat Defense](https://partner.samsungknox.com/mtd)
- [MITRE ATT&CK Mobile - T1623](https://attack.mitre.org/techniques/T1623)
