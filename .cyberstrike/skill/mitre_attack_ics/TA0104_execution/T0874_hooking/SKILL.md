---
name: "T0874_hooking"
description: "Adversaries may hook into application programming interface (API) functions used by processes to redirect calls for execution and privilege escalation means."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0874
  - execution
  - privilege-escalation
technique_id: "T0874"
tactic: "execution"
all_tactics:
  - execution
  - privilege-escalation
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0874"
tech_stack:
  - ics
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0874 Hooking

## High-Level Description

Adversaries may hook into application programming interface (API) functions used by processes to redirect calls for execution and privilege escalation means. Windows processes often leverage these API functions to perform tasks that require reusable system resources. Windows API functions are typically stored in dynamic-link libraries (DLLs) as exported functions.

One type of hooking seen in ICS involves redirecting calls to these functions via import address table (IAT) hooking. IAT hooking uses modifications to a process IAT, where pointers to imported API functions are stored.

## Kill Chain Phase

- Execution (TA0104)
- Privilege Escalation (TA0111)

**Platforms:** ICS

## What to Check

- [ ] Identify if Hooking technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Hooking
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Hooking by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0874 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0944 Restrict Library Loading

Restrict the use of untrusted or unknown libraries, such as remote or unknown DLLs.

### M0947 Audit

Perform audits or scans of systems, permissions, insecure software, insecure configurations, etc. to identify potential weaknesses. Perform periodic integrity checks of the device to validate the correctness of the firmware, software, programs, and configurations. Integrity checks, which typically include cryptographic hashes or digital signatures, should be compared to those obtained at known valid states, especially after events like device reboots, program downloads, or program restarts.

## Detection

### Detection of Hooking

## Risk Assessment

| Finding                      | Severity | Impact    |
| ---------------------------- | -------- | --------- |
| Hooking technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Enterprise ATT&CK](https://attack.mitre.org/techniques/T1179/)
- [Nicolas Falliere, Liam O Murchu, Eric Chien February 2011](https://docs.broadcom.com/doc/security-response-w32-stuxnet-dossier-11-en)
- [MITRE ATT&CK ICS - T0874](https://attack.mitre.org/techniques/T0874)
