---
name: "T0836_modify-parameter"
description: "Adversaries may modify parameters used to instruct industrial control system devices."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0836
  - impair-process-control
technique_id: "T0836"
tactic: "impair-process-control"
all_tactics:
  - impair-process-control
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0836"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0836 Modify Parameter

## High-Level Description

Adversaries may modify parameters used to instruct industrial control system devices. These devices operate via programs that dictate how and when to perform actions based on such parameters. Such parameters can determine the extent to which an action is performed and may specify additional options. For example, a program on a control system device dictating motor processes may take a parameter defining the total number of seconds to run that motor. 

An adversary can potentially modify these parameters to produce an outcome outside of what was intended by the operators. By modifying system and process critical parameters, the adversary may cause Impact to equipment and/or control processes. Modified parameters may be turned into dangerous, out-of-bounds, or unexpected values from typical operations. For example, specifying that a process run for more or less time than it should, or dictating an unusually high, low, or invalid value as a parameter.

## Kill Chain Phase

- Impair Process Control (TA0106)

**Platforms:** ICS

## What to Check

- [ ] Identify if Modify Parameter technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Modify Parameter
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Modify Parameter by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0836 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0947 Audit
Provide the ability to verify the integrity and authenticity of changes to parameter values.

### M0804 Human User Authentication
All field controllers should require that user authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0800 Authorization Enforcement
All field controllers should restrict the modification of parameter values to only certain users (e.g., engineers, field technician), preferably through implementing a role-based access mechanism. They should also restrict online edits and enable write protection for parameters.

### M0818 Validate Program Inputs
Devices and programs should validate the content of any remote parameter changes, including those from HMIs, control servers, or engineering workstations.


## Detection

### Detection of Modify Parameter


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Modify Parameter technique applicable | Low | Impair Process Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [MITRE ATT&CK ICS - T0836](https://attack.mitre.org/techniques/T0836)
