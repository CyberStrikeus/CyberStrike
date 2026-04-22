---
name: "T1011_exfiltration-over-other-network-medium"
description: "Adversaries may attempt to exfiltrate data over a different network medium than the command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1011
  - exfiltration
  - linux
  - macos
  - windows
technique_id: "T1011"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1011"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1011.001
prerequisites:
  []
severity_boost:
  T1011.001: "Chain with T1011.001 for deeper attack path"
---

# T1011 Exfiltration Over Other Network Medium

## High-Level Description

Adversaries may attempt to exfiltrate data over a different network medium than the command and control channel. If the command and control network is a wired Internet connection, the exfiltration may occur, for example, over a WiFi connection, modem, cellular data connection, Bluetooth, or another radio frequency (RF) channel.

Adversaries may choose to do this if they have sufficient access or proximity, and the connection might not be secured or defended as well as the primary Internet-connected channel because it is not routed through the same enterprise network.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Exfiltration Over Other Network Medium technique is applicable to target environment
- [ ] Check Linux systems for indicators of Exfiltration Over Other Network Medium
- [ ] Check macOS systems for indicators of Exfiltration Over Other Network Medium
- [ ] Check Windows systems for indicators of Exfiltration Over Other Network Medium
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over Other Network Medium by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1011 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Disable WiFi connection, modem, cellular data connection, Bluetooth, or another radio frequency (RF) channel in local computer security settings or by group policy if it is not needed within an environment.

### M1028 Operating System Configuration
Prevent the creation of new network adapters where possible.


## Detection

### Detection of Exfiltration Over Alternate Network Interfaces


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Exfiltration Over Other Network Medium technique applicable | Low | Exfiltration |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Atomic Red Team - T1011](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1011)
- [MITRE ATT&CK - T1011](https://attack.mitre.org/techniques/T1011)
