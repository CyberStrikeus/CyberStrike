---
name: "T1008_fallback-channels"
description: "Adversaries may use fallback or alternate communication channels if the primary channel is compromised or inaccessible in order to maintain reliable command and control and to avoid data transfer thre"
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1008
  - command-and-control
  - linux
  - windows
  - macos
  - esxi
technique_id: "T1008"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - Windows
  - macOS
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1008"
tech_stack:
  - linux
  - windows
  - macos
  - esxi
cwe_ids:
  - CWE-300
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1008 Fallback Channels

## High-Level Description

Adversaries may use fallback or alternate communication channels if the primary channel is compromised or inaccessible in order to maintain reliable command and control and to avoid data transfer thresholds.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, Windows, macOS, ESXi

## What to Check

- [ ] Identify if Fallback Channels technique is applicable to target environment
- [ ] Check Linux systems for indicators of Fallback Channels
- [ ] Check Windows systems for indicators of Fallback Channels
- [ ] Check macOS systems for indicators of Fallback Channels
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Fallback Channels by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific protocol used by a particular adversary or tool, and will likely be different across various malware families and versions. Adversaries will likely change tool C2 signatures over time or construct protocols in such a way as to avoid detection by common defensive tools.

## Detection

### Behavioral Detection of Fallback or Alternate C2 Channels

## Risk Assessment

| Finding                                | Severity | Impact              |
| -------------------------------------- | -------- | ------------------- |
| Fallback Channels technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1008)
- [MITRE ATT&CK - T1008](https://attack.mitre.org/techniques/T1008)
