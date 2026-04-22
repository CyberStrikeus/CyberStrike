---
name: "T1634.001_keychain"
description: "Adversaries may collect keychain data from an iOS device to acquire credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1634.001
  - credential-access
  - ios
  - sub-technique
technique_id: "T1634.001"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1634/001"
tech_stack:
  - ios
cwe_ids:
  - CWE-522
chains_with:
  - T1634
prerequisites:
  - T1634
severity_boost:
  T1634: "Chain with T1634 for deeper attack path"
---

# T1634.001 Keychain

> **Sub-technique of:** T1634

## High-Level Description

Adversaries may collect keychain data from an iOS device to acquire credentials. Keychains are the built-in way for iOS to keep track of users' passwords and credentials for many services and features such as Wi-Fi passwords, websites, secure notes, certificates, private keys, and VPN credentials.

On the device, the keychain database is stored outside of application sandboxes to prevent unauthorized access to the raw data. Standard iOS APIs allow applications access to their own keychain contained within the database. By utilizing a privilege escalation exploit or existing root access, adversaries can access the entire encrypted database.

## Kill Chain Phase

- Credential Access (TA0031)

**Platforms:** iOS

## What to Check

- [ ] Identify if Keychain technique is applicable to target mobile environment
- [ ] Check iOS devices for indicators of Keychain
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Keychain by examining the target platforms (iOS).

### Assess Existing Defenses

Review whether mitigations for T1634.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1010 Deploy Compromised Device Detection Method

Mobile security products can take appropriate action when jailbroken devices are detected, potentially limiting the adversary’s access to password stores.

### M1001 Security Updates

Apple regularly provides security updates for known OS vulnerabilities.

### M1002 Attestation

Device attestation can often detect jailbroken devices.

## Detection

### Detection of Keychain

## Risk Assessment

| Finding                       | Severity | Impact            |
| ----------------------------- | -------- | ----------------- |
| Keychain technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Apple Keychain Services](https://developer.apple.com/documentation/security/keychain_services)
- [Elcomsoft Decrypt Keychain](https://blog.elcomsoft.com/2018/12/six-ways-to-decrypt-iphone-passwords-from-the-keychain/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/authentication-threats/AUT-11.html)
- [MITRE ATT&CK Mobile - T1634.001](https://attack.mitre.org/techniques/T1634/001)
