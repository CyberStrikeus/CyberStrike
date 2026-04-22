---
name: "T1104_multi-stage-channels"
description: "Adversaries may create multiple stages for command and control that are employed under different conditions or for certain functions."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1104
  - command-and-control
  - linux
  - macos
  - windows
  - esxi
technique_id: "T1104"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1104"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1104 Multi-Stage Channels

## High-Level Description

Adversaries may create multiple stages for command and control that are employed under different conditions or for certain functions. Use of multiple stages may obfuscate the command and control channel to make detection more difficult.

Remote access tools will call back to the first-stage command and control server for instructions. The first stage may have automated capabilities to collect basic host information, update tools, and upload additional files. A second remote access tool (RAT) could be uploaded at that point to redirect the host to the second-stage command and control server. The second stage will likely be more fully featured and allow the adversary to interact with the system through a reverse shell and additional RAT features.

The different stages will likely be hosted separately with no overlapping infrastructure. The loader may also have backup first-stage callbacks or Fallback Channels in case the original first-stage communication path is discovered and blocked.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Multi-Stage Channels technique is applicable to target environment
- [ ] Check Linux systems for indicators of Multi-Stage Channels
- [ ] Check macOS systems for indicators of Multi-Stage Channels
- [ ] Check Windows systems for indicators of Multi-Stage Channels
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Multi-Stage Channels by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1104 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.


## Detection

### Detect Multi-Stage Command and Control Channels


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Multi-Stage Channels technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [Atomic Red Team - T1104](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1104)
- [MITRE ATT&CK - T1104](https://attack.mitre.org/techniques/T1104)
