---
name: "T1588.003_code-signing-certificates"
description: "Adversaries may buy and/or steal code signing certificates that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1588.003
  - resource-development
  - pre
  - sub-technique
technique_id: "T1588.003"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1588/003"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1588
  - T1588.001
  - T1588.002
  - T1588.004
  - T1588.005
  - T1588.006
  - T1588.007
prerequisites:
  - T1588
severity_boost:
  T1588: "Chain with T1588 for deeper attack path"
  T1588.001: "Chain with T1588.001 for deeper attack path"
  T1588.002: "Chain with T1588.002 for deeper attack path"
---

# T1588.003 Code Signing Certificates

> **Sub-technique of:** T1588

## High-Level Description

Adversaries may buy and/or steal code signing certificates that can be used during targeting. Code signing is the process of digitally signing executables and scripts to confirm the software author and guarantee that the code has not been altered or corrupted. Code signing provides a level of authenticity for a program from the developer and a guarantee that the program has not been tampered with. Users and/or security tools may trust a signed piece of code more than an unsigned piece of code even if they don't know who issued the certificate or who the author is.

Prior to Code Signing, adversaries may purchase or steal code signing certificates for use in operations. The purchase of code signing certificates may be done using a front organization or using information stolen from a previously compromised entity that allows the adversary to validate to a certificate provider as that entity. Adversaries may also steal code signing materials directly from a compromised third-party.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Code Signing Certificates technique is applicable to target environment
- [ ] Check PRE systems for indicators of Code Signing Certificates
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Code Signing Certificates by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1588.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Code Signing Certificates


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Code Signing Certificates technique applicable | Low | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Wikipedia Code Signing](https://en.wikipedia.org/wiki/Code_signing)
- [Atomic Red Team - T1588.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1588.003)
- [MITRE ATT&CK - T1588.003](https://attack.mitre.org/techniques/T1588/003)
