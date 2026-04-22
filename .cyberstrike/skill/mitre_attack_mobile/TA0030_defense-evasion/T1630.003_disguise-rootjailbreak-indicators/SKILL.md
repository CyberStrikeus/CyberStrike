---
name: "T1630.003_disguise-rootjailbreak-indicators"
description: "An adversary could use knowledge of the techniques used by security software to evade detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1630.003
  - defense-evasion
  - android
  - ios
  - sub-technique
technique_id: "T1630.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1630/003"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1630
  - T1630.001
  - T1630.002
prerequisites:
  - T1630
severity_boost:
  T1630: "Chain with T1630 for deeper attack path"
  T1630.001: "Chain with T1630.001 for deeper attack path"
  T1630.002: "Chain with T1630.002 for deeper attack path"
---

# T1630.003 Disguise Root/Jailbreak Indicators

> **Sub-technique of:** T1630

## High-Level Description

An adversary could use knowledge of the techniques used by security software to evade detection. For example, some mobile security products perform compromised device detection by searching for particular artifacts such as an installed "su" binary, but that check could be evaded by naming the binary something else. Similarly, polymorphic code techniques could be used to evade signature-based detection.

## Kill Chain Phase

- Defense Evasion (TA0030)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Disguise Root/Jailbreak Indicators technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Disguise Root/Jailbreak Indicators
- [ ] Check iOS devices for indicators of Disguise Root/Jailbreak Indicators
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Disguise Root/Jailbreak Indicators by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1630.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Disguise Root/Jailbreak Indicators


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Disguise Root/Jailbreak Indicators technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Brodie](https://media.blackhat.com/eu-13/briefings/Brodie/bh-eu-13-lacoon-attacks-mdm-brodie-wp.pdf)
- [Rastogi](http://pages.cs.wisc.edu/~vrastogi/static/papers/rcj13b.pdf)
- [Tan](http://www.blackhat.com/us-16/briefings.html#bad-for-enterprise-attacking-byod-enterprise-mobile-security-solutions)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/emm-threats/EMM-5.html)
- [MITRE ATT&CK Mobile - T1630.003](https://attack.mitre.org/techniques/T1630/003)
