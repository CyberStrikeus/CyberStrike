---
name: "T1521.002_asymmetric-cryptography"
description: "Adversaries may employ a known asymmetric encryption algorithm to conceal command and control traffic, rather than relying on any inherent protections provided by a communication protocol."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1521.002
  - command-and-control
  - android
  - ios
  - sub-technique
technique_id: "T1521.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1521/002"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1521
  - T1521.001
  - T1521.003
prerequisites:
  - T1521
severity_boost:
  T1521: "Chain with T1521 for deeper attack path"
  T1521.001: "Chain with T1521.001 for deeper attack path"
  T1521.003: "Chain with T1521.003 for deeper attack path"
---

# T1521.002 Asymmetric Cryptography

> **Sub-technique of:** T1521

## High-Level Description

Adversaries may employ a known asymmetric encryption algorithm to conceal command and control traffic, rather than relying on any inherent protections provided by a communication protocol. Asymmetric cryptography, also known as public key cryptography, uses a keypair per party: one public that can be freely distributed, and one private that should not be distributed. Due to how asymmetric algorithms work, the sender encrypts data with the receiver’s public key and the receiver decrypts the data with their private key. This ensures that only the intended recipient can read the encrypted data. Common public key encryption algorithms include RSA, ElGamal, and ECDSA.

For efficiency, many protocols (including SSL/TLS) use symmetric cryptography once a connection is established, but use asymmetric cryptography to establish or transmit a key. As such, these protocols are classified as Asymmetric Cryptography.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Asymmetric Cryptography technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Asymmetric Cryptography
- [ ] Check iOS devices for indicators of Asymmetric Cryptography
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Asymmetric Cryptography by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1521.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Asymmetric Cryptography


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Asymmetric Cryptography technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1521.002](https://attack.mitre.org/techniques/T1521/002)
