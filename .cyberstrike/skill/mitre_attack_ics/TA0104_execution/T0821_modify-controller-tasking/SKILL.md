---
name: "T0821_modify-controller-tasking"
description: "Adversaries may modify the tasking of a controller to allow for the execution of their own programs."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0821
  - execution
technique_id: "T0821"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0821"
tech_stack:
  - ics
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0821 Modify Controller Tasking

## High-Level Description

Adversaries may modify the tasking of a controller to allow for the execution of their own programs. This can allow an adversary to manipulate the execution flow and behavior of a controller.

According to 61131-3, the association of a Task with a Program Organization Unit (POU) defines a task association. An adversary may modify these associations or create new ones to manipulate the execution flow of a controller. Modification of controller tasking can be accomplished using a Program Download in addition to other types of program modification such as online edit and program append.

Tasks have properties, such as interval, frequency and priority to meet the requirements of program execution. Some controller vendors implement tasks with implicit, pre-defined properties whereas others allow for these properties to be formulated explicitly. An adversary may associate their program with tasks that have a higher priority or execute associated programs more frequently. For instance, to ensure cyclic execution of their program on a Siemens controller, an adversary may add their program to the task, Organization Block 1 (OB1).

## Kill Chain Phase

- Execution (TA0104)

**Platforms:** ICS

## What to Check

- [ ] Identify if Modify Controller Tasking technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Modify Controller Tasking
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Modify Controller Tasking by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0821 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0800 Authorization Enforcement

All field controllers should restrict the modification of controller tasks to only certain users (e.g., engineers, field technician), preferably through implementing a role-based access mechanism.

### M0804 Human User Authentication

All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0947 Audit

Provide the ability to verify the integrity of controller tasking. While techniques like CRCs and checksums are commonly used, they are not cryptographically secure and can be vulnerable to collisions. Preferably cryptographic hash functions (e.g., SHA-2, SHA-3) should be used.

### M0945 Code Signing

Utilize code signatures to verify the integrity and authenticity of programs installed on safety or control assets, including the associated controller tasking.

## Detection

### Detection of Modify Controller Tasking

## Risk Assessment

| Finding                                        | Severity | Impact    |
| ---------------------------------------------- | -------- | --------- |
| Modify Controller Tasking technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [IEC February 2013](https://webstore.iec.ch/publication/4552)
- [MITRE ATT&CK ICS - T0821](https://attack.mitre.org/techniques/T0821)
