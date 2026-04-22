---
name: "T1052_exfiltration-over-physical-medium"
description: "Adversaries may attempt to exfiltrate data via a physical medium, such as a removable drive."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1052
  - exfiltration
  - linux
  - macos
  - windows
technique_id: "T1052"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1052"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1052.001
prerequisites: []
severity_boost:
  T1052.001: "Chain with T1052.001 for deeper attack path"
---

# T1052 Exfiltration Over Physical Medium

## High-Level Description

Adversaries may attempt to exfiltrate data via a physical medium, such as a removable drive. In certain circumstances, such as an air-gapped network compromise, exfiltration could occur via a physical medium or device introduced by a user. Such media could be an external hard drive, USB drive, cellular phone, MP3 player, or other removable storage and processing device. The physical medium or device could be used as the final exfiltration point or to hop between otherwise disconnected systems.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Exfiltration Over Physical Medium technique is applicable to target environment
- [ ] Check Linux systems for indicators of Exfiltration Over Physical Medium
- [ ] Check macOS systems for indicators of Exfiltration Over Physical Medium
- [ ] Check Windows systems for indicators of Exfiltration Over Physical Medium
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over Physical Medium by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1052 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1057 Data Loss Prevention

Data loss prevention can detect and block sensitive data being copied to physical mediums.

### M1034 Limit Hardware Installation

Limit the use of USB devices and removable media within a network.

### M1042 Disable or Remove Feature or Program

Disable Autorun if it is unnecessary. Disallow or restrict removable media at an organizational policy level if they are not required for business operations.

## Detection

### Detection of Data Exfiltration via Removable Media

## Risk Assessment

| Finding                                                | Severity | Impact       |
| ------------------------------------------------------ | -------- | ------------ |
| Exfiltration Over Physical Medium technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1052](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1052)
- [MITRE ATT&CK - T1052](https://attack.mitre.org/techniques/T1052)
