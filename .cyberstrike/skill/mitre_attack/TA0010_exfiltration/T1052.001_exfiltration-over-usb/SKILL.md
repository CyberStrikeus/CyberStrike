---
name: "T1052.001_exfiltration-over-usb"
description: "Adversaries may attempt to exfiltrate data over a USB connected physical device."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1052.001
  - exfiltration
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1052.001"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1052/001"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-200
chains_with:
  - T1052
prerequisites:
  - T1052
severity_boost:
  T1052: "Chain with T1052 for deeper attack path"
---

# T1052.001 Exfiltration over USB

> **Sub-technique of:** T1052

## High-Level Description

Adversaries may attempt to exfiltrate data over a USB connected physical device. In certain circumstances, such as an air-gapped network compromise, exfiltration could occur via a USB device introduced by a user. The USB device could be used as the final exfiltration point or to hop between otherwise disconnected systems.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Exfiltration over USB technique is applicable to target environment
- [ ] Check Linux systems for indicators of Exfiltration over USB
- [ ] Check Windows systems for indicators of Exfiltration over USB
- [ ] Check macOS systems for indicators of Exfiltration over USB
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration over USB by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1052.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Disable Autorun if it is unnecessary. Disallow or restrict removable media at an organizational policy level if they are not required for business operations.

### M1034 Limit Hardware Installation

Limit the use of USB devices and removable media within a network.

### M1057 Data Loss Prevention

Data loss prevention can detect and block sensitive data being copied to USB devices.

## Detection

### Detection of USB-Based Data Exfiltration

## Risk Assessment

| Finding                                    | Severity | Impact       |
| ------------------------------------------ | -------- | ------------ |
| Exfiltration over USB technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1052.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1052.001)
- [MITRE ATT&CK - T1052.001](https://attack.mitre.org/techniques/T1052/001)
