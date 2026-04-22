---
name: "T1056_input-capture"
description: "Adversaries may use methods of capturing user input to obtain credentials or collect information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1056
  - collection
  - credential-access
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1056"
tactic: "collection"
all_tactics:
  - collection
  - credential-access
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1056"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1056.001
  - T1056.002
  - T1056.003
  - T1056.004
prerequisites:
  []
severity_boost:
  T1056.001: "Chain with T1056.001 for deeper attack path"
  T1056.002: "Chain with T1056.002 for deeper attack path"
  T1056.003: "Chain with T1056.003 for deeper attack path"
---

# T1056 Input Capture

## High-Level Description

Adversaries may use methods of capturing user input to obtain credentials or collect information. During normal system usage, users often provide credentials to various different locations, such as login pages/portals or system dialog boxes. Input capture mechanisms may be transparent to the user (e.g. Credential API Hooking) or rely on deceiving the user into providing input into what they believe to be a genuine service (e.g. Web Portal Capture).

## Kill Chain Phase

- Collection (TA0009)
- Credential Access (TA0006)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Input Capture technique is applicable to target environment
- [ ] Check Linux systems for indicators of Input Capture
- [ ] Check macOS systems for indicators of Input Capture
- [ ] Check Network Devices systems for indicators of Input Capture
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Input Capture by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1056 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Input Capture Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Input Capture technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Adventures of a Keystroke](http://opensecuritytraining.info/Keylogging_files/The%20Adventures%20of%20a%20Keystroke.pdf)
- [Atomic Red Team - T1056](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1056)
- [MITRE ATT&CK - T1056](https://attack.mitre.org/techniques/T1056)
