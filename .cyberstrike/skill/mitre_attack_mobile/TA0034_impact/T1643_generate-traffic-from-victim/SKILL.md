---
name: "T1643_generate-traffic-from-victim"
description: "Adversaries may generate outbound traffic from devices."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1643
  - impact
  - android
  - ios
technique_id: "T1643"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1643"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1643 Generate Traffic from Victim

## High-Level Description

Adversaries may generate outbound traffic from devices. This is typically performed to manipulate external outcomes, such as to achieve carrier billing fraud or to manipulate app store rankings or ratings. Outbound traffic is typically generated as SMS messages or general web traffic, but may take other forms as well.

If done via SMS messages, Android apps must hold the `SEND_SMS` permission. Additionally, sending an SMS message requires user consent if the recipient is a premium number. Applications cannot send SMS messages on iOS

## Kill Chain Phase

- Impact (TA0034)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Generate Traffic from Victim technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Generate Traffic from Victim
- [ ] Check iOS devices for indicators of Generate Traffic from Victim
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Generate Traffic from Victim by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1643 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

### M1011 User Guidance

Users should be advised that applications generally do not require permission to send SMS messages.

## Detection

### Detection of Generate Traffic from Victim

## Risk Assessment

| Finding                                           | Severity | Impact |
| ------------------------------------------------- | -------- | ------ |
| Generate Traffic from Victim technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/application-threats/APP-16.html)
- [MITRE ATT&CK Mobile - T1643](https://attack.mitre.org/techniques/T1643)
