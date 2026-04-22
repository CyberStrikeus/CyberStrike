---
name: "T1634_credentials-from-password-store"
description: "Adversaries may search common password storage locations to obtain user credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1634
  - credential-access
  - ios
technique_id: "T1634"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1634"
tech_stack:
  - ios
cwe_ids:
  - CWE-522
chains_with:
  - T1634.001
prerequisites:
  []
severity_boost:
  T1634.001: "Chain with T1634.001 for deeper attack path"
---

# T1634 Credentials from Password Store

## High-Level Description

Adversaries may search common password storage locations to obtain user credentials. Passwords can be stored in several places on a device, depending on the operating system or application holding the credentials. There are also specific applications that store passwords to make it easier for users to manage and maintain. Once credentials are obtained, they can be used to perform lateral movement and access restricted information.

## Kill Chain Phase

- Credential Access (TA0031)

**Platforms:** iOS

## What to Check

- [ ] Identify if Credentials from Password Store technique is applicable to target mobile environment
- [ ] Check iOS devices for indicators of Credentials from Password Store
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Credentials from Password Store by examining the target platforms (iOS).

### Assess Existing Defenses

Review whether mitigations for T1634 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1001 Security Updates
Apple regularly provides security updates for known OS vulnerabilities.

### M1002 Attestation
Device attestation can often detect jailbroken devices.

### M1010 Deploy Compromised Device Detection Method
Mobile security products can take appropriate action when jailbroken devices are detected, potentially limiting the adversary’s access to password stores.


## Detection

### Detection of Credentials from Password Store


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Credentials from Password Store technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/authentication-threats/AUT-11.html)
- [MITRE ATT&CK Mobile - T1634](https://attack.mitre.org/techniques/T1634)
