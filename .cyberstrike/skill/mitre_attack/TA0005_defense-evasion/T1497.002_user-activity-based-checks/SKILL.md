---
name: "T1497.002_user-activity-based-checks"
description: "Adversaries may employ various user activity checks to detect and avoid virtualization and analysis environments."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1497.002
  - defense-evasion
  - discovery
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1497.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - discovery
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1497/002"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1497
  - T1497.001
  - T1497.003
prerequisites:
  - T1497
severity_boost:
  T1497: "Chain with T1497 for deeper attack path"
  T1497.001: "Chain with T1497.001 for deeper attack path"
  T1497.003: "Chain with T1497.003 for deeper attack path"
---

# T1497.002 User Activity Based Checks

> **Sub-technique of:** T1497

## High-Level Description

Adversaries may employ various user activity checks to detect and avoid virtualization and analysis environments. This may include changing behaviors based on the results of checks for the presence of artifacts indicative of a virtual machine environment (VME) or sandbox. If the adversary detects a VME, they may alter their malware to disengage from the victim or conceal the core functions of the implant. They may also search for VME artifacts before dropping secondary or additional payloads. Adversaries may use the information learned from Virtualization/Sandbox Evasion during automated discovery to shape follow-on behaviors.

Adversaries may search for user activity on the host based on variables such as the speed/frequency of mouse movements and clicks , browser history, cache, bookmarks, or number of files in common directories such as home or the desktop. Other methods may rely on specific user interaction with the system before the malicious code is activated, such as waiting for a document to close before activating a macro or waiting for a user to double click on an embedded image to activate.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Discovery (TA0007)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if User Activity Based Checks technique is applicable to target environment
- [ ] Check Linux systems for indicators of User Activity Based Checks
- [ ] Check Windows systems for indicators of User Activity Based Checks
- [ ] Check macOS systems for indicators of User Activity Based Checks
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to User Activity Based Checks by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1497.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect User Activity Based Sandbox Evasion via Input & Artifact Probing


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| User Activity Based Checks technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [FireEye FIN7 April 2017](https://www.fireeye.com/blog/threat-research/2017/04/fin7-phishing-lnk.html)
- [Unit 42 Sofacy Nov 2018](https://unit42.paloaltonetworks.com/unit42-sofacy-continues-global-attacks-wheels-new-cannon-trojan/)
- [Sans Virtual Jan 2016](https://www.sans.org/reading-room/whitepapers/forensics/detecting-malware-sandbox-evasion-techniques-36667)
- [Deloitte Environment Awareness](https://drive.google.com/file/d/1t0jn3xr4ff2fR30oQAUn_RsWSnMpOAQc/edit)
- [Atomic Red Team - T1497.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1497.002)
- [MITRE ATT&CK - T1497.002](https://attack.mitre.org/techniques/T1497/002)
