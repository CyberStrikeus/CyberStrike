---
name: "T1219.003_remote-access-hardware"
description: "An adversary may use legitimate remote access hardware to establish an interactive command and control channel to target systems within networks."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1219.003
  - command-and-control
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1219.003"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1219/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1219
  - T1219.001
  - T1219.002
prerequisites:
  - T1219
severity_boost:
  T1219: "Chain with T1219 for deeper attack path"
  T1219.001: "Chain with T1219.001 for deeper attack path"
  T1219.002: "Chain with T1219.002 for deeper attack path"
---

# T1219.003 Remote Access Hardware

> **Sub-technique of:** T1219

## High-Level Description

An adversary may use legitimate remote access hardware to establish an interactive command and control channel to target systems within networks. These services, including IP-based keyboard, video, or mouse (KVM) devices such as TinyPilot and PiKVM, are commonly used as legitimate tools and may be allowed by peripheral device policies within a target environment.

Remote access hardware may be physically installed and used post-compromise as an alternate communications channel for redundant access or as a way to establish an interactive remote session with the target system. Using hardware-based remote access tools may allow threat actors to bypass software security solutions and gain more control over the compromised device(s).

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Remote Access Hardware technique is applicable to target environment
- [ ] Check Linux systems for indicators of Remote Access Hardware
- [ ] Check macOS systems for indicators of Remote Access Hardware
- [ ] Check Windows systems for indicators of Remote Access Hardware
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Remote Access Hardware by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1219.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1034 Limit Hardware Installation

Block the use of IP-based KVM devices within the network if they are not required.

## Detection

### Detect Remote Access via USB Hardware (TinyPilot, PiKVM)

## Risk Assessment

| Finding                                     | Severity | Impact              |
| ------------------------------------------- | -------- | ------------------- |
| Remote Access Hardware technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [Google Cloud Threat Intelligence DPRK IT Workers 2024](https://cloud.google.com/blog/topics/threat-intelligence/mitigating-dprk-it-worker-threat/)
- [Palo Alto Unit 42 North Korean IT Workers 2024](https://unit42.paloaltonetworks.com/north-korean-it-workers/)
- [Atomic Red Team - T1219.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1219.003)
- [MITRE ATT&CK - T1219.003](https://attack.mitre.org/techniques/T1219/003)
