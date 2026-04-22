---
name: "T1481_web-service"
description: "Adversaries may use an existing, legitimate external Web service as a means for relaying data to/from a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1481
  - command-and-control
  - android
  - ios
technique_id: "T1481"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1481"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1481.001
  - T1481.002
  - T1481.003
prerequisites: []
severity_boost:
  T1481.001: "Chain with T1481.001 for deeper attack path"
  T1481.002: "Chain with T1481.002 for deeper attack path"
  T1481.003: "Chain with T1481.003 for deeper attack path"
---

# T1481 Web Service

## High-Level Description

Adversaries may use an existing, legitimate external Web service as a means for relaying data to/from a compromised system. Popular websites and social media, acting as a mechanism for C2, may give a significant amount of cover. This is due to the likelihood that hosts within a network are already communicating with them prior to a compromise. Using common services, such as those offered by Google or Twitter, makes it easier for adversaries to hide in expected noise. Web service providers commonly use SSL/TLS encryption, giving adversaries an added level of protection.

Use of Web services may also protect back-end C2 infrastructure from discovery through malware binary analysis, or enable operational resiliency (since this infrastructure may be dynamically changed).

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Web Service technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Web Service
- [ ] Check iOS devices for indicators of Web Service
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Web Service by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1481 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Web Service

## Risk Assessment

| Finding                          | Severity | Impact              |
| -------------------------------- | -------- | ------------------- |
| Web Service technique applicable | Medium   | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [MITRE ATT&CK Mobile - T1481](https://attack.mitre.org/techniques/T1481)
