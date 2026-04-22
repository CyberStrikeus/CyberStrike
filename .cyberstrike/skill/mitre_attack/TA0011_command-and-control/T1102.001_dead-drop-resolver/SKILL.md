---
name: "T1102.001_dead-drop-resolver"
description: "Adversaries may use an existing, legitimate external Web service to host information that points to additional command and control (C2) infrastructure."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1102.001
  - command-and-control
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1102.001"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1102/001"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1102
  - T1102.002
  - T1102.003
prerequisites:
  - T1102
severity_boost:
  T1102: "Chain with T1102 for deeper attack path"
  T1102.002: "Chain with T1102.002 for deeper attack path"
  T1102.003: "Chain with T1102.003 for deeper attack path"
---

# T1102.001 Dead Drop Resolver

> **Sub-technique of:** T1102

## High-Level Description

Adversaries may use an existing, legitimate external Web service to host information that points to additional command and control (C2) infrastructure. Adversaries may post content, known as a dead drop resolver, on Web services with embedded (and often obfuscated/encoded) domains or IP addresses. Once infected, victims will reach out to and be redirected by these resolvers.

Popular websites and social media acting as a mechanism for C2 may give a significant amount of cover due to the likelihood that hosts within a network are already communicating with them prior to a compromise. Using common services, such as those offered by Google or Twitter, makes it easier for adversaries to hide in expected noise. Web service providers commonly use SSL/TLS encryption, giving adversaries an added level of protection.

Use of a dead drop resolver may also protect back-end C2 infrastructure from discovery through malware binary analysis while also enabling operational resiliency (since this infrastructure may be dynamically changed).

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Dead Drop Resolver technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Dead Drop Resolver
- [ ] Check Linux systems for indicators of Dead Drop Resolver
- [ ] Check macOS systems for indicators of Dead Drop Resolver
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Dead Drop Resolver by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1102.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1021 Restrict Web-Based Content
Web proxies can be used to enforce external network communication policy that prevents use of unauthorized external services.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.


## Detection

### Detection Strategy for Web Service: Dead Drop Resolver


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Dead Drop Resolver technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1102.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1102.001)
- [MITRE ATT&CK - T1102.001](https://attack.mitre.org/techniques/T1102/001)
