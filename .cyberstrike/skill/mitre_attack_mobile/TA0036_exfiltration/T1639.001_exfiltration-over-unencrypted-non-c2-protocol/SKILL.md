---
name: "T1639.001_exfiltration-over-unencrypted-non-c2-protocol"
description: "Adversaries may steal data by exfiltrating it over an un-encrypted network protocol other than that of the existing command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1639.001
  - exfiltration
  - android
  - ios
  - sub-technique
technique_id: "T1639.001"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1639/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1639
prerequisites:
  - T1639
severity_boost:
  T1639: "Chain with T1639 for deeper attack path"
---

# T1639.001 Exfiltration Over Unencrypted Non-C2 Protocol

> **Sub-technique of:** T1639

## High-Level Description

Adversaries may steal data by exfiltrating it over an un-encrypted network protocol other than that of the existing command and control channel. The data may also be sent to an alternate network location from the main command and control server.

Adversaries may opt to obfuscate this data, without the use of encryption, within network protocols that are natively unencrypted (such as HTTP, FTP, or DNS). Adversaries may employ custom or publicly available encoding/compression algorithms (such as base64) or embed data within protocol headers and fields.

## Kill Chain Phase

- Exfiltration (TA0036)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Exfiltration Over Unencrypted Non-C2 Protocol technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Exfiltration Over Unencrypted Non-C2 Protocol
- [ ] Check iOS devices for indicators of Exfiltration Over Unencrypted Non-C2 Protocol
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Exfiltration Over Unencrypted Non-C2 Protocol by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1639.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Exfiltration Over Unencrypted Non-C2 Protocol

## Risk Assessment

| Finding                                                            | Severity | Impact       |
| ------------------------------------------------------------------ | -------- | ------------ |
| Exfiltration Over Unencrypted Non-C2 Protocol technique applicable | Medium   | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-30.html)
- [MITRE ATT&CK Mobile - T1639.001](https://attack.mitre.org/techniques/T1639/001)
