---
name: "T0889_modify-program"
description: "Adversaries may modify or add a program on a controller to affect how it interacts with the physical process, peripheral devices and other hosts on the network."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0889
  - persistence
technique_id: "T0889"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0889"
tech_stack:
  - ics
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0889 Modify Program

## High-Level Description

Adversaries may modify or add a program on a controller to affect how it interacts with the physical process, peripheral devices and other hosts on the network. Modification to controller programs can be accomplished using a Program Download in addition to other types of program modification such as online edit and program append.

Program modification encompasses the addition and modification of instructions and logic contained in Program Organization Units (POU) and similar programming elements found on controllers. This can include, for example, adding new functions to a controller, modifying the logic in existing functions and making new calls from one function to another.

Some programs may allow an adversary to interact directly with the native API of the controller to take advantage of obscure features or vulnerabilities.

## Kill Chain Phase

- Persistence (TA0110)

**Platforms:** ICS

## What to Check

- [ ] Identify if Modify Program technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Modify Program
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Modify Program by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0889 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0947 Audit

Provide the ability to verify the integrity of control logic or programs loaded on a controller. While techniques like CRCs and checksums are commonly used, they are not cryptographically strong and can be vulnerable to collisions. Preferably cryptographic hash functions (e.g., SHA-2, SHA-3) should be used.

### M0945 Code Signing

Utilize code signatures to verify the integrity and authenticity of programs installed on safety or control assets.

### M0800 Authorization Enforcement

All field controllers should restrict the modification of programs to only certain users (e.g., engineers, field technician), preferably through implementing a role-based access mechanism.

### M0804 Human User Authentication

All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

## Detection

### Detection of Modify Program

## Risk Assessment

| Finding                             | Severity | Impact      |
| ----------------------------------- | -------- | ----------- |
| Modify Program technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [IEC February 2013](https://webstore.iec.ch/publication/4552)
- [MITRE ATT&CK ICS - T0889](https://attack.mitre.org/techniques/T0889)
