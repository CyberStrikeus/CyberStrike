---
name: "T1092_communication-through-removable-media"
description: "Adversaries can perform command and control between compromised hosts on potentially disconnected networks using removable media to transfer commands from system to system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1092
  - command-and-control
  - linux
  - macos
  - windows
technique_id: "T1092"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1092"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1092 Communication Through Removable Media

## High-Level Description

Adversaries can perform command and control between compromised hosts on potentially disconnected networks using removable media to transfer commands from system to system. Both systems would need to be compromised, with the likelihood that an Internet-connected system was compromised first and the second through lateral movement by Replication Through Removable Media. Commands and files would be relayed from the disconnected system to the Internet-connected system to which the adversary has direct access.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Communication Through Removable Media technique is applicable to target environment
- [ ] Check Linux systems for indicators of Communication Through Removable Media
- [ ] Check macOS systems for indicators of Communication Through Removable Media
- [ ] Check Windows systems for indicators of Communication Through Removable Media
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Communication Through Removable Media by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1092 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Disable Autoruns if it is unnecessary.

### M1028 Operating System Configuration
Disallow or restrict removable media at an organizational policy level if they are not required for business operations.


## Detection

### Cross-host C2 via Removable Media Relay


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Communication Through Removable Media technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [ESET Sednit USBStealer 2014](http://www.welivesecurity.com/2014/11/11/sednit-espionage-group-attacking-air-gapped-networks/)
- [Atomic Red Team - T1092](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1092)
- [MITRE ATT&CK - T1092](https://attack.mitre.org/techniques/T1092)
