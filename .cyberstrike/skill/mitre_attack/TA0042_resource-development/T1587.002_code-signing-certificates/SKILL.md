---
name: "T1587.002_code-signing-certificates"
description: "Adversaries may create self-signed code signing certificates that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1587.002
  - resource-development
  - pre
  - sub-technique
technique_id: "T1587.002"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1587/002"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1587
  - T1587.001
  - T1587.003
  - T1587.004
prerequisites:
  - T1587
severity_boost:
  T1587: "Chain with T1587 for deeper attack path"
  T1587.001: "Chain with T1587.001 for deeper attack path"
  T1587.003: "Chain with T1587.003 for deeper attack path"
---

# T1587.002 Code Signing Certificates

> **Sub-technique of:** T1587

## High-Level Description

Adversaries may create self-signed code signing certificates that can be used during targeting. Code signing is the process of digitally signing executables and scripts to confirm the software author and guarantee that the code has not been altered or corrupted. Code signing provides a level of authenticity for a program from the developer and a guarantee that the program has not been tampered with. Users and/or security tools may trust a signed piece of code more than an unsigned piece of code even if they don't know who issued the certificate or who the author is.

Prior to Code Signing, adversaries may develop self-signed code signing certificates for use in operations.

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

2. **Assess Existing Defenses**: Review whether mitigations for T1587.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

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
- [Atomic Red Team - T1587.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1587.002)
- [MITRE ATT&CK - T1587.002](https://attack.mitre.org/techniques/T1587/002)
