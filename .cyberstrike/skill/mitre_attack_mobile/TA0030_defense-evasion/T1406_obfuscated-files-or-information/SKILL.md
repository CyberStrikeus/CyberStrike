---
name: "T1406_obfuscated-files-or-information"
description: "Adversaries may attempt to make a payload or file difficult to discover or analyze by encrypting, encoding, or otherwise obfuscating its contents on the device or in transit."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1406
  - defense-evasion
  - android
  - ios
technique_id: "T1406"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1406"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1406.001
  - T1406.002
prerequisites: []
severity_boost:
  T1406.001: "Chain with T1406.001 for deeper attack path"
  T1406.002: "Chain with T1406.002 for deeper attack path"
---

# T1406 Obfuscated Files or Information

## High-Level Description

Adversaries may attempt to make a payload or file difficult to discover or analyze by encrypting, encoding, or otherwise obfuscating its contents on the device or in transit. This is common behavior that can be used across different platforms and the network to evade defenses.

Payloads may be compressed, archived, or encrypted in order to avoid detection. These payloads may be used during Initial Access or later to mitigate detection. Portions of files can also be encoded to hide the plaintext strings that would otherwise help defenders with discovery. Payloads may also be split into separate, seemingly benign files that only reveal malicious functionality when reassembled.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Obfuscated Files or Information technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Obfuscated Files or Information
- [ ] Check iOS devices for indicators of Obfuscated Files or Information
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Obfuscated Files or Information by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1406 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Obfuscated Files or Information

## Risk Assessment

| Finding                                              | Severity | Impact          |
| ---------------------------------------------------- | -------- | --------------- |
| Obfuscated Files or Information technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft MalLockerB](https://www.microsoft.com/security/blog/2020/10/08/sophisticated-new-android-malware-marks-the-latest-evolution-of-mobile-ransomware/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-21.html)
- [MITRE ATT&CK Mobile - T1406](https://attack.mitre.org/techniques/T1406)
