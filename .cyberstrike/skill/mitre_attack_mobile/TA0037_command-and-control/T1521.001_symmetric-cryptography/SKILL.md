---
name: "T1521.001_symmetric-cryptography"
description: "Adversaries may employ a known symmetric encryption algorithm to conceal command and control traffic, rather than relying on any inherent protections provided by a communication protocol."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1521.001
  - command-and-control
  - android
  - ios
  - sub-technique
technique_id: "T1521.001"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1521/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1521
  - T1521.002
  - T1521.003
prerequisites:
  - T1521
severity_boost:
  T1521: "Chain with T1521 for deeper attack path"
  T1521.002: "Chain with T1521.002 for deeper attack path"
  T1521.003: "Chain with T1521.003 for deeper attack path"
---

# T1521.001 Symmetric Cryptography

> **Sub-technique of:** T1521

## High-Level Description

Adversaries may employ a known symmetric encryption algorithm to conceal command and control traffic, rather than relying on any inherent protections provided by a communication protocol. Symmetric encryption algorithms use the same key for plaintext encryption and ciphertext decryption. Common symmetric encryption algorithms include AES, Blowfish, and RC4.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Symmetric Cryptography technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Symmetric Cryptography
- [ ] Check iOS devices for indicators of Symmetric Cryptography
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Symmetric Cryptography by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1521.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Symmetric Cryptography


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Symmetric Cryptography technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1521.001](https://attack.mitre.org/techniques/T1521/001)
