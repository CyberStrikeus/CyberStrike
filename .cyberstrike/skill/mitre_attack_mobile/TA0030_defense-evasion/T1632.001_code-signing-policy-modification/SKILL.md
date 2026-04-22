---
name: "T1632.001_code-signing-policy-modification"
description: "Adversaries may modify code signing policies to enable execution of applications signed with unofficial or unknown keys."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1632.001
  - defense-evasion
  - android
  - ios
  - sub-technique
technique_id: "T1632.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1632/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1632
prerequisites:
  - T1632
severity_boost:
  T1632: "Chain with T1632 for deeper attack path"
---

# T1632.001 Code Signing Policy Modification

> **Sub-technique of:** T1632

## High-Level Description

Adversaries may modify code signing policies to enable execution of applications signed with unofficial or unknown keys. Code signing provides a level of authenticity on an app from a developer, guaranteeing that the program has not been tampered with and comes from an official source. Security controls can include enforcement mechanisms to ensure that only valid, signed code can be run on a device. 

Mobile devices generally enable these security controls by default, such as preventing the installation of unknown applications on Android. Adversaries may modify these policies in a number of ways, including Input Injection or malicious configuration profiles.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Code Signing Policy Modification technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Code Signing Policy Modification
- [ ] Check iOS devices for indicators of Code Signing Policy Modification
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Code Signing Policy Modification by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1632.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1012 Enterprise Policy
On iOS, the `allowEnterpriseAppTrust` and `allowEnterpriseAppTrustModification` configuration profile restrictions can be used to prevent users from installing apps signed using enterprise distribution keys.

### M1006 Use Recent OS Version
Mobile OSes have implemented measures to make it more difficult to trick users into installing untrusted certificates and configurations. iOS 10.3 and higher add an additional step for users to install new trusted CA certificates and configuration profiles. On Android, apps that target compatibility with Android 7 and higher (API Level 24) default to only trusting CA certificates that are bundled with the operating system, not CA certificates that are added by the user or administrator, hence decreasing their susceptibility to successful adversary-in-the-middle attack.

### M1011 User Guidance
Typically, insecure or malicious configuration settings are not installed without the user's consent. Users should be advised not to install unexpected configuration settings (CA certificates, iOS Configuration Profiles, Mobile Device Management server provisioning).


## Detection

### Detection of Code Signing Policy Modification


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Code Signing Policy Modification technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/stack-threats/STA-7.html)
- [MITRE ATT&CK Mobile - T1632.001](https://attack.mitre.org/techniques/T1632/001)
