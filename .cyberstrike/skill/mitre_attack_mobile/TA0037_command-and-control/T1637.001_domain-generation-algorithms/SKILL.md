---
name: "T1637.001_domain-generation-algorithms"
description: "Adversaries may use Domain Generation Algorithms (DGAs) to procedurally generate domain names for uses such as command and control communication or malicious application distribution."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1637.001
  - command-and-control
  - android
  - ios
  - sub-technique
technique_id: "T1637.001"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1637/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-300
chains_with:
  - T1637
prerequisites:
  - T1637
severity_boost:
  T1637: "Chain with T1637 for deeper attack path"
---

# T1637.001 Domain Generation Algorithms

> **Sub-technique of:** T1637

## High-Level Description

Adversaries may use Domain Generation Algorithms (DGAs) to procedurally generate domain names for uses such as command and control communication or malicious application distribution.

DGAs increase the difficulty for defenders to block, track, or take over the command and control channel, as there could potentially be thousands of domains that malware can check for instructions.

## Kill Chain Phase

- Command and Control (TA0037)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Domain Generation Algorithms technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Domain Generation Algorithms
- [ ] Check iOS devices for indicators of Domain Generation Algorithms
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Domain Generation Algorithms by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1637.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Domain Generation Algorithms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Domain Generation Algorithms technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [Data Driven Security DGA](https://datadrivensecurity.info/blog/posts/2014/Oct/dga-part2/)
- [securelist rotexy 2018](https://securelist.com/the-rotexy-mobile-trojan-banker-and-ransomware/88893/)
- [MITRE ATT&CK Mobile - T1637.001](https://attack.mitre.org/techniques/T1637/001)
