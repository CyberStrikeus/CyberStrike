---
name: "T1464_network-denial-of-service"
description: "Adversaries may perform Network Denial of Service (DoS) attacks to degrade or block the availability of targeted resources to users."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1464
  - impact
  - android
  - ios
technique_id: "T1464"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1464"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1464 Network Denial of Service

## High-Level Description

Adversaries may perform Network Denial of Service (DoS) attacks to degrade or block the availability of targeted resources to users. Network DoS can be performed by exhausting the network bandwidth that services rely on, or by jamming the signal going to or coming from devices.

A Network DoS will occur when an adversary is able to jam radio signals (e.g. Wi-Fi, cellular, GPS) around a device to prevent it from communicating. For example, to jam cellular signal, an adversary may use a handheld signal jammer, which jam devices within the jammer’s operational range.

Usage of cellular jamming has been documented in several arrests reported in the news.

## Kill Chain Phase

- Impact (TA0034)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Network Denial of Service technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Network Denial of Service
- [ ] Check iOS devices for indicators of Network Denial of Service
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Network Denial of Service by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1464 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Network Denial of Service

## Risk Assessment

| Finding                                        | Severity | Impact |
| ---------------------------------------------- | -------- | ------ |
| Network Denial of Service technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [CNET-Celljammer](https://www.cnet.com/news/man-put-cell-phone-jammer-in-car-to-stop-driver-calls-fcc-says/)
- [Arstechnica-Celljam](https://arstechnica.com/tech-policy/2016/03/man-accused-of-jamming-passengers-cell-phones-on-chicago-subway/)
- [NIST-SP800187](http://csrc.nist.gov/publications/drafts/800-187/sp800_187_draft.pdf)
- [NYTimes-Celljam](https://www.nytimes.com/2007/11/04/technology/04jammer.html)
- [Digitaltrends-Celljam](https://www.digitaltrends.com/mobile/florida-teacher-punished-after-signal-jamming-his-students-cell-phones/)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-7.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/cellular-threats/CEL-8.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/lan-pan-threats/LPN-5.html)
- [NIST Mobile Threat Catalogue](https://pages.nist.gov/mobile-threat-catalogue/gps-threats/GPS-0.html)
- [MITRE ATT&CK Mobile - T1464](https://attack.mitre.org/techniques/T1464)
