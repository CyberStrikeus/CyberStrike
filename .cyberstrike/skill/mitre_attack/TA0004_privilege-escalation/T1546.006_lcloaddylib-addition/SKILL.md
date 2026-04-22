---
name: "T1546.006_lcloaddylib-addition"
description: "Adversaries may establish persistence by executing malicious content triggered by the execution of tainted binaries."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.006
  - privilege-escalation
  - persistence
  - macos
  - sub-technique
technique_id: "T1546.006"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1546/006"
tech_stack:
  - macos
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.006 LC_LOAD_DYLIB Addition

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence by executing malicious content triggered by the execution of tainted binaries. Mach-O binaries have a series of headers that are used to perform certain operations when a binary is loaded. The LC_LOAD_DYLIB header in a Mach-O binary tells macOS and OS X which dynamic libraries (dylibs) to load during execution time. These can be added ad-hoc to the compiled binary as long as adjustments are made to the rest of the fields and dependencies. There are tools available to perform these changes.

Adversaries may modify Mach-O binary headers to load and execute malicious dylibs every time the binary is executed. Although any changes will invalidate digital signatures on binaries because the binary is being modified, this can be remediated by simply removing the LC_CODE_SIGNATURE command from the binary so that the signature isn’t checked at load time.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** macOS

## What to Check

- [ ] Identify if LC_LOAD_DYLIB Addition technique is applicable to target environment
- [ ] Check macOS systems for indicators of LC_LOAD_DYLIB Addition
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to LC_LOAD_DYLIB Addition by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Binaries can also be baselined for what dynamic libraries they require, and if an app requires a new dynamic library that wasn't included as part of an update, it should be investigated.

### M1038 Execution Prevention

Allow applications via known hashes.

### M1045 Code Signing

Enforce that all binaries be signed by the correct Apple Developer IDs.

## Detection

### Detection Strategy for LC_LOAD_DYLIB Modification in Mach-O Binaries on macOS

## Risk Assessment

| Finding                                     | Severity | Impact               |
| ------------------------------------------- | -------- | -------------------- |
| LC_LOAD_DYLIB Addition technique applicable | Low      | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [Malware Persistence on OS X](https://www.virusbulletin.com/uploads/pdf/conference/vb2014/VB2014-Wardle.pdf)
- [Writing Bad Malware for OSX](https://www.blackhat.com/docs/us-15/materials/us-15-Wardle-Writing-Bad-A-Malware-For-OS-X.pdf)
- [Atomic Red Team - T1546.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.006)
- [MITRE ATT&CK - T1546.006](https://attack.mitre.org/techniques/T1546/006)
