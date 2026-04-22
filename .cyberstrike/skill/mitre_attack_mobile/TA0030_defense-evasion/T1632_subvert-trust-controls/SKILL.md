---
name: "T1632_subvert-trust-controls"
description: "Adversaries may undermine security controls that will either warn users of untrusted activity or prevent execution of untrusted applications."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1632
  - defense-evasion
  - android
  - ios
technique_id: "T1632"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1632"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1632.001
prerequisites: []
severity_boost:
  T1632.001: "Chain with T1632.001 for deeper attack path"
---

# T1632 Subvert Trust Controls

## High-Level Description

Adversaries may undermine security controls that will either warn users of untrusted activity or prevent execution of untrusted applications. Operating systems and security products may contain mechanisms to identify programs or websites as possessing some level of trust. Examples of such features include: an app being allowed to run because it is signed by a valid code signing certificate; an OS prompt alerting the user that an app came from an untrusted source; or getting an indication that you are about to connect to an untrusted site. The method adversaries use will depend on the specific mechanism they seek to subvert.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Subvert Trust Controls technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Subvert Trust Controls
- [ ] Check iOS devices for indicators of Subvert Trust Controls
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Subvert Trust Controls by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1632 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

Typically, insecure or malicious configuration settings are not installed without the user's consent. Users should be advised not to install unexpected configuration settings (CA certificates, iOS Configuration Profiles, Mobile Device Management server provisioning).

### M1006 Use Recent OS Version

Mobile OSes have implemented measures to make it more difficult to trick users into installing untrusted certificates and configurations. iOS 10.3 and higher add an additional step for users to install new trusted CA certificates and configuration profiles. On Android, apps that target compatibility with Android 7 and higher (API Level 24) default to only trusting CA certificates that are bundled with the operating system, not CA certificates that are added by the user or administrator, hence decreasing their susceptibility to successful adversary-in-the-middle attack.

### M1012 Enterprise Policy

On iOS, the `allowEnterpriseAppTrust` and `allowEnterpriseAppTrustModification` configuration profile restrictions can be used to prevent users from installing apps signed using enterprise distribution keys.

## Detection

### Detection of Subvert Trust Controls

## Risk Assessment

| Finding                                     | Severity | Impact          |
| ------------------------------------------- | -------- | --------------- |
| Subvert Trust Controls technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/stack-threats/STA-7.html)
- [MITRE ATT&CK Mobile - T1632](https://attack.mitre.org/techniques/T1632)
