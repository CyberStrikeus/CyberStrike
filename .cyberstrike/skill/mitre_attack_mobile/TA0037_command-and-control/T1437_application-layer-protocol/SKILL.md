---
name: "T1437_application-layer-protocol"
description: "Adversaries may communicate using application layer protocols to avoid detection/network filtering by blending in with existing traffic."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1437
  - command-and-control
  - android
  - ios
technique_id: "T1437"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1437"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1437.001
prerequisites:
  []
severity_boost:
  T1437.001: "Chain with T1437.001 for deeper attack path"
---

# T1437 Application Layer Protocol

## High-Level Description

Adversaries may communicate using application layer protocols to avoid detection/network filtering by blending in with existing traffic. Commands to the mobile device, and often the results of those commands, will be embedded within the protocol traffic between the mobile device and server. 

Adversaries may utilize many different protocols, including those used for web browsing, transferring files, electronic mail, or DNS.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Application Layer Protocol technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Application Layer Protocol
- [ ] Check iOS devices for indicators of Application Layer Protocol
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Application Layer Protocol by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1437 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Application Layer Protocol


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Application Layer Protocol technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-29.html)
- [MITRE ATT&CK Mobile - T1437](https://attack.mitre.org/techniques/T1437)
