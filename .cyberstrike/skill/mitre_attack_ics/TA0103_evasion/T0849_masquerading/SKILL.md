---
name: "T0849_masquerading"
description: "Adversaries may use masquerading to disguise a malicious application or executable as another file, to avoid operator and engineer suspicion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0849
  - evasion
technique_id: "T0849"
tactic: "evasion"
all_tactics:
  - evasion
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0849"
tech_stack:
  - ics
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0849 Masquerading

## High-Level Description

Adversaries may use masquerading to disguise a malicious application or executable as another file, to avoid operator and engineer suspicion. Possible disguises of these masquerading files can include commonly found programs, expected vendor executables and configuration files, and other commonplace application and naming conventions. By impersonating expected and vendor-relevant files and applications, operators and engineers may not notice the presence of the underlying malicious content and possibly end up running those masquerading as legitimate functions.

Applications and other files commonly found on Windows systems or in engineering workstations have been impersonated before. This can be as simple as renaming a file to effectively disguise it in the ICS environment.

## Kill Chain Phase

- Evasion (TA0103)

**Platforms:** ICS

## What to Check

- [ ] Identify if Masquerading technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Masquerading
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Masquerading by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0849 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0945 Code Signing

Require signed binaries.

### M0938 Execution Prevention

Use tools that restrict program execution via application control by attributes other than file name for common system and application utilities.

### M0922 Restrict File and Directory Permissions

Use file system access controls to protect system and application folders.

## Detection

### Detection of Masquerading

## Risk Assessment

| Finding                           | Severity | Impact  |
| --------------------------------- | -------- | ------- |
| Masquerading technique applicable | Low      | Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [MITRE ATT&CK ICS - T0849](https://attack.mitre.org/techniques/T0849)
