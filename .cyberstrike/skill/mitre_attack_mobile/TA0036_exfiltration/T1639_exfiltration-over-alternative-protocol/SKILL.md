---
name: "T1639_exfiltration-over-alternative-protocol"
description: "Adversaries may steal data by exfiltrating it over a different protocol than that of the existing command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1639
  - exfiltration
  - android
  - ios
technique_id: "T1639"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1639"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-200
chains_with:
  - T1639.001
prerequisites: []
severity_boost:
  T1639.001: "Chain with T1639.001 for deeper attack path"
---

# T1639 Exfiltration Over Alternative Protocol

## High-Level Description

Adversaries may steal data by exfiltrating it over a different protocol than that of the existing command and control channel. The data may also be sent to an alternate network location from the main command and control server.

Alternate protocols include FTP, SMTP, HTTP/S, DNS, SMB, or any other network protocol not being used as the main command and control channel. Different protocol channels could also include Web services such as cloud storage. Adversaries may opt to also encrypt and/or obfuscate these alternate channels.

## Kill Chain Phase

- Exfiltration (TA0036)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Exfiltration Over Alternative Protocol technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Exfiltration Over Alternative Protocol
- [ ] Check iOS devices for indicators of Exfiltration Over Alternative Protocol
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Exfiltration Over Alternative Protocol by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1639 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Exfiltration Over Alternative Protocol

## Risk Assessment

| Finding                                                     | Severity | Impact       |
| ----------------------------------------------------------- | -------- | ------------ |
| Exfiltration Over Alternative Protocol technique applicable | Medium   | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-30.html)
- [MITRE ATT&CK Mobile - T1639](https://attack.mitre.org/techniques/T1639)
