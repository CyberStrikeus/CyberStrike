---
name: "T1474.002_compromise-hardware-supply-chain"
description: "Adversaries may manipulate hardware components in products prior to receipt by a final consumer for the purpose of data or system compromise."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1474.002
  - initial-access
  - android
  - ios
  - sub-technique
technique_id: "T1474.002"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1474/002"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-20
chains_with:
  - T1474
  - T1474.001
  - T1474.003
prerequisites:
  - T1474
severity_boost:
  T1474: "Chain with T1474 for deeper attack path"
  T1474.001: "Chain with T1474.001 for deeper attack path"
  T1474.003: "Chain with T1474.003 for deeper attack path"
---

# T1474.002 Compromise Hardware Supply Chain

> **Sub-technique of:** T1474

## High-Level Description

Adversaries may manipulate hardware components in products prior to receipt by a final consumer for the purpose of data or system compromise. By modifying hardware or firmware in the supply chain, adversaries can insert a backdoor into consumer networks that may be difficult to detect and give the adversary a high degree of control over the system.

## Kill Chain Phase

- Initial Access (TA0027)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Compromise Hardware Supply Chain technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Compromise Hardware Supply Chain
- [ ] Check iOS devices for indicators of Compromise Hardware Supply Chain
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Compromise Hardware Supply Chain by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1474.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1001 Security Updates
Security updates may contain patches to integrity checking mechanisms that can detect unauthorized hardware modifications.


## Detection

### Detection of Compromise Hardware Supply Chain


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compromise Hardware Supply Chain technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-1.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-2.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-4.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-5.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-6.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-7.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-8.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-13.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-16.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-17.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/supply-chain-threats/SPC-21.html)
- [MITRE ATT&CK Mobile - T1474.002](https://attack.mitre.org/techniques/T1474/002)
