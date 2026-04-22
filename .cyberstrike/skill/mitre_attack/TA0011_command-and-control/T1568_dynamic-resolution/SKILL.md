---
name: "T1568_dynamic-resolution"
description: "Adversaries may dynamically establish connections to command and control infrastructure to evade common detections and remediations."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1568
  - command-and-control
  - linux
  - macos
  - windows
  - esxi
technique_id: "T1568"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1568"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1568.001
  - T1568.002
  - T1568.003
prerequisites: []
severity_boost:
  T1568.001: "Chain with T1568.001 for deeper attack path"
  T1568.002: "Chain with T1568.002 for deeper attack path"
  T1568.003: "Chain with T1568.003 for deeper attack path"
---

# T1568 Dynamic Resolution

## High-Level Description

Adversaries may dynamically establish connections to command and control infrastructure to evade common detections and remediations. This may be achieved by using malware that shares a common algorithm with the infrastructure the adversary uses to receive the malware's communications. These calculations can be used to dynamically adjust parameters such as the domain name, IP address, or port number the malware uses for command and control.

Adversaries may use dynamic resolution for the purpose of Fallback Channels. When contact is lost with the primary command and control server malware may employ dynamic resolution as a means to reestablishing command and control.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Dynamic Resolution technique is applicable to target environment
- [ ] Check Linux systems for indicators of Dynamic Resolution
- [ ] Check macOS systems for indicators of Dynamic Resolution
- [ ] Check Windows systems for indicators of Dynamic Resolution
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Dynamic Resolution by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1568 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Malware researchers can reverse engineer malware variants that use dynamic resolution and determine future C2 infrastructure that the malware will attempt to contact, but this is a time and resource intensive effort.

### M1021 Restrict Web-Based Content

In some cases a local DNS sinkhole may be used to help prevent behaviors associated with dynamic resolution.

## Detection

### Detection Strategy for Dynamic Resolution across OS Platforms

## Risk Assessment

| Finding                                 | Severity | Impact              |
| --------------------------------------- | -------- | ------------------- |
| Dynamic Resolution technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [Talos CCleanup 2017](http://blog.talosintelligence.com/2017/09/avast-distributes-malware.html)
- [FireEye POSHSPY April 2017](https://www.fireeye.com/blog/threat-research/2017/03/dissecting_one_ofap.html)
- [ESET Sednit 2017 Activity](https://www.welivesecurity.com/2017/12/21/sednit-update-fancy-bear-spent-year/)
- [Data Driven Security DGA](https://datadrivensecurity.info/blog/posts/2014/Oct/dga-part2/)
- [Atomic Red Team - T1568](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1568)
- [MITRE ATT&CK - T1568](https://attack.mitre.org/techniques/T1568)
