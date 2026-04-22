---
name: "T1481.002_bidirectional-communication"
description: "Adversaries may use an existing, legitimate external Web service channel as a means for sending commands to and receiving output from a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1481.002
  - command-and-control
  - android
  - ios
  - sub-technique
technique_id: "T1481.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1481/002"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1481
  - T1481.001
  - T1481.003
prerequisites:
  - T1481
severity_boost:
  T1481: "Chain with T1481 for deeper attack path"
  T1481.001: "Chain with T1481.001 for deeper attack path"
  T1481.003: "Chain with T1481.003 for deeper attack path"
---

# T1481.002 Bidirectional Communication

> **Sub-technique of:** T1481

## High-Level Description

Adversaries may use an existing, legitimate external Web service channel as a means for sending commands to and receiving output from a compromised system. Compromised systems may leverage popular websites and social media to host command and control (C2) instructions. Those infected systems can then send the output from those commands back over that Web service channel. The return traffic may occur in a variety of ways, depending on the Web service being utilized. For example, the return traffic may take the form of the compromised system posting a comment on a forum, issuing a pull request to development project, updating a document hosted on a Web service, or by sending a Tweet. 

 

Popular websites and social media, acting as a mechanism for C2, may give a significant amount of cover. This is due to the likelihood that hosts within a network are already communicating with them prior to a compromise. Using common services, such as those offered by Google or Twitter, makes it easier for adversaries to hide in expected noise. Web service providers commonly use SSL/TLS encryption, giving adversaries an added level of protection.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Bidirectional Communication technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Bidirectional Communication
- [ ] Check iOS devices for indicators of Bidirectional Communication
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Bidirectional Communication by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1481.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Bidirectional Communication


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Bidirectional Communication technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MITRE ATT&CK Mobile - T1481.002](https://attack.mitre.org/techniques/T1481/002)
