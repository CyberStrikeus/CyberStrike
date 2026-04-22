---
name: "T1474.001_compromise-software-dependencies-and-development-tools"
description: "Adversaries may manipulate products or product delivery mechanisms prior to receipt by a final consumer for the purpose of data or system compromise."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1474.001
  - initial-access
  - android
  - ios
  - sub-technique
technique_id: "T1474.001"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1474/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-20
chains_with:
  - T1474
  - T1474.002
  - T1474.003
prerequisites:
  - T1474
severity_boost:
  T1474: "Chain with T1474 for deeper attack path"
  T1474.002: "Chain with T1474.002 for deeper attack path"
  T1474.003: "Chain with T1474.003 for deeper attack path"
---

# T1474.001 Compromise Software Dependencies and Development Tools

> **Sub-technique of:** T1474

## High-Level Description

Adversaries may manipulate products or product delivery mechanisms prior to receipt by a final consumer for the purpose of data or system compromise. Applications often depend on external software to function properly. Popular open source projects that are used as dependencies in many applications may be targeted as a means to add malicious code to users of the dependency.

## Kill Chain Phase

- Initial Access (TA0027)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Compromise Software Dependencies and Development Tools technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Compromise Software Dependencies and Development Tools
- [ ] Check iOS devices for indicators of Compromise Software Dependencies and Development Tools
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Compromise Software Dependencies and Development Tools by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1474.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1013 Application Developer Guidance
Application developers should be cautious when selecting third-party libraries to integrate into their application.


## Detection

### Detection of Compromise Software Dependencies and Development Tools


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compromise Software Dependencies and Development Tools technique applicable | Low | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Grace-Advertisement](https://dl.acm.org/doi/10.1145/2185448.2185464)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-6.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-0.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-3.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-9.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-10.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-15.html)
- [MITRE ATT&CK Mobile - T1474.001](https://attack.mitre.org/techniques/T1474/001)
