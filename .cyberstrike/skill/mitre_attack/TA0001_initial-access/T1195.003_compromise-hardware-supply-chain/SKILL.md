---
name: "T1195.003_compromise-hardware-supply-chain"
description: "Adversaries may manipulate hardware components in products prior to receipt by a final consumer for the purpose of data or system compromise."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1195.003
  - initial-access
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1195.003"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1195/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-20
chains_with:
  - T1195
  - T1195.001
  - T1195.002
prerequisites:
  - T1195
severity_boost:
  T1195: "Chain with T1195 for deeper attack path"
  T1195.001: "Chain with T1195.001 for deeper attack path"
  T1195.002: "Chain with T1195.002 for deeper attack path"
---

# T1195.003 Compromise Hardware Supply Chain

> **Sub-technique of:** T1195

## High-Level Description

Adversaries may manipulate hardware components in products prior to receipt by a final consumer for the purpose of data or system compromise. By modifying hardware or firmware in the supply chain, adversaries can insert a backdoor into consumer networks that may be difficult to detect and give the adversary a high degree of control over the system. Hardware backdoors may be inserted into various devices, such as servers, workstations, network infrastructure, or peripherals.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Compromise Hardware Supply Chain technique is applicable to target environment
- [ ] Check Linux systems for indicators of Compromise Hardware Supply Chain
- [ ] Check macOS systems for indicators of Compromise Hardware Supply Chain
- [ ] Check Windows systems for indicators of Compromise Hardware Supply Chain
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compromise Hardware Supply Chain by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1195.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1046 Boot Integrity

Use Trusted Platform Module technology and a secure or trusted boot process to prevent system integrity from being compromised. Check the integrity of the existing BIOS or EFI to determine if it is vulnerable to modification.

## Detection

### Hardware Supply Chain Compromise Detection via Host Status & Boot Integrity Checks

## Risk Assessment

| Finding                                               | Severity | Impact         |
| ----------------------------------------------------- | -------- | -------------- |
| Compromise Hardware Supply Chain technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Atomic Red Team - T1195.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1195.003)
- [MITRE ATT&CK - T1195.003](https://attack.mitre.org/techniques/T1195/003)
