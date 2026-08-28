---
name: "T1630.001_uninstall-malicious-application"
description: "Adversaries may include functionality in malware that uninstalls the malicious application from the device."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1630.001
  - defense-evasion
  - android
  - sub-technique
technique_id: "T1630.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
mitre_url: "https://attack.mitre.org/techniques/T1630/001"
tech_stack:
  - android
cwe_ids:
  - CWE-693
chains_with:
  - T1630
  - T1630.002
  - T1630.003
prerequisites:
  - T1630
severity_boost:
  T1630: "Chain with T1630 for deeper attack path"
  T1630.002: "Chain with T1630.002 for deeper attack path"
  T1630.003: "Chain with T1630.003 for deeper attack path"
---

# T1630.001 Uninstall Malicious Application

> **Sub-technique of:** T1630

## High-Level Description

Adversaries may include functionality in malware that uninstalls the malicious application from the device. This can be achieved by:

- Abusing device owner permissions to perform silent uninstallation using device owner API calls.
- Abusing root permissions to delete files from the filesystem.
- Abusing the accessibility service. This requires sending an intent to the system to request uninstallation, and then abusing the accessibility service to click the proper places on the screen to confirm uninstallation.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android

## What to Check

- [ ] Identify if Uninstall Malicious Application technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Uninstall Malicious Application
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Uninstall Malicious Application by examining the target platforms (Android).

### Assess Existing Defenses

Review whether mitigations for T1630.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1001 Security Updates

Security updates typically provide patches for vulnerabilities that enable device rooting.

### M1011 User Guidance

Inform users that device rooting or granting unnecessary access to the accessibility service presents security risks that could be taken advantage of without their knowledge.

### M1002 Attestation

Attestation can detect rooted devices. Mobile security software can then use this information and take appropriate mitigation action. Attestation can detect rooted devices.

## Detection

### Detection of Uninstall Malicious Application

## Risk Assessment

| Finding                                              | Severity | Impact          |
| ---------------------------------------------------- | -------- | --------------- |
| Uninstall Malicious Application technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-43.html)
- [MITRE ATT&CK Mobile - T1630.001](https://attack.mitre.org/techniques/T1630/001)
