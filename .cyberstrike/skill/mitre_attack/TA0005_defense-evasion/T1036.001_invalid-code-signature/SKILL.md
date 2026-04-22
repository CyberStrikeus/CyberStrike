---
name: "T1036.001_invalid-code-signature"
description: "Adversaries may attempt to mimic features of valid code signatures to increase the chance of deceiving a user, analyst, or tool."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.001
  - defense-evasion
  - windows
  - macos
  - sub-technique
technique_id: "T1036.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1036/001"
tech_stack:
  - windows
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.002
  - T1036.003
  - T1036.004
  - T1036.005
  - T1036.006
  - T1036.007
  - T1036.008
  - T1036.009
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
  T1036.003: "Chain with T1036.003 for deeper attack path"
---

# T1036.001 Invalid Code Signature

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may attempt to mimic features of valid code signatures to increase the chance of deceiving a user, analyst, or tool. Code signing provides a level of authenticity on a binary from the developer and a guarantee that the binary has not been tampered with. Adversaries can copy the metadata and signature information from a signed program, then use it as a template for an unsigned program. Files with invalid code signatures will fail digital signature validation checks, but they may appear more legitimate to users and security tools may improperly handle these files.

Unlike Code Signing, this activity will not result in a valid signature.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, macOS

## What to Check

- [ ] Identify if Invalid Code Signature technique is applicable to target environment
- [ ] Check Windows systems for indicators of Invalid Code Signature
- [ ] Check macOS systems for indicators of Invalid Code Signature
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Invalid Code Signature by examining the target platforms (Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1045 Code Signing
Require signed binaries.


## Detection

### Invalid Code Signature Execution Detection via Metadata and Behavioral Context


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Invalid Code Signature technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Threatexpress MetaTwin 2017](https://threatexpress.com/blogs/2017/metatwin-borrowing-microsoft-metadata-and-digital-signatures-to-hide-binaries/)
- [Atomic Red Team - T1036.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.001)
- [MITRE ATT&CK - T1036.001](https://attack.mitre.org/techniques/T1036/001)
