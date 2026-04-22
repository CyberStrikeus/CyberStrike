---
name: "T1029_scheduled-transfer"
description: "Adversaries may schedule data exfiltration to be performed only at certain times of day or at certain intervals."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1029
  - exfiltration
  - linux
  - macos
  - windows
technique_id: "T1029"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1029"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1029 Scheduled Transfer

## High-Level Description

Adversaries may schedule data exfiltration to be performed only at certain times of day or at certain intervals. This could be done to blend traffic patterns with normal activity or availability.

When scheduled exfiltration is used, other exfiltration techniques likely apply as well to transfer the information out of the network, such as Exfiltration Over C2 Channel or Exfiltration Over Alternative Protocol.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Scheduled Transfer technique is applicable to target environment
- [ ] Check Linux systems for indicators of Scheduled Transfer
- [ ] Check macOS systems for indicators of Scheduled Transfer
- [ ] Check Windows systems for indicators of Scheduled Transfer
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Scheduled Transfer by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1029 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary command and control infrastructure and malware can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific obfuscation technique used by a particular adversary or tool, and will likely be different across various malware families and versions. Adversaries will likely change tool command and control signatures over time or construct protocols in such a way to avoid detection by common defensive tools.

## Detection

### Detection Strategy for Scheduled Transfer and Recurrent Exfiltration Patterns

## Risk Assessment

| Finding                                 | Severity | Impact       |
| --------------------------------------- | -------- | ------------ |
| Scheduled Transfer technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1029](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1029)
- [MITRE ATT&CK - T1029](https://attack.mitre.org/techniques/T1029)
