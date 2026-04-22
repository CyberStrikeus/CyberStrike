---
name: "T1481.003_one-way-communication"
description: "Adversaries may use an existing, legitimate external Web service channel as a means for sending commands to a compromised system without receiving return output."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1481.003
  - command-and-control
  - android
  - ios
  - sub-technique
technique_id: "T1481.003"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1481/003"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1481
  - T1481.001
  - T1481.002
prerequisites:
  - T1481
severity_boost:
  T1481: "Chain with T1481 for deeper attack path"
  T1481.001: "Chain with T1481.001 for deeper attack path"
  T1481.002: "Chain with T1481.002 for deeper attack path"
---

# T1481.003 One-Way Communication

> **Sub-technique of:** T1481

## High-Level Description

Adversaries may use an existing, legitimate external Web service channel as a means for sending commands to a compromised system without receiving return output. Compromised systems may leverage popular websites and social media to host command and control (C2) instructions. Those infected systems may opt to send the output from those commands back over a different C2 channel, including to another distinct Web service. Alternatively, compromised systems may return no output at all in cases where adversaries want to send instructions to systems and do not want a response. 

 

Popular websites and social media, acting as a mechanism for C2, may give a significant amount of cover. This is due to the likelihood that hosts within a network are already communicating with them prior to a compromise. Using common services, such as those offered by Google or Twitter, makes it easier for adversaries to hide in expected noise. Web service providers commonly use SSL/TLS encryption, giving adversaries an added level of protection.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if One-Way Communication technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of One-Way Communication
- [ ] Check iOS devices for indicators of One-Way Communication
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to One-Way Communication by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1481.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of One-Way Communication


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| One-Way Communication technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1481.003](https://attack.mitre.org/techniques/T1481/003)
