---
name: "T0801_monitor-process-state"
description: "Adversaries may gather information about the physical process state."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0801
  - collection
technique_id: "T0801"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0801"
tech_stack:
  - ics
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0801 Monitor Process State

## High-Level Description

Adversaries may gather information about the physical process state. This information may be used to gain more information about the process itself or used as a trigger for malicious actions. The sources of process state information may vary such as, OPC tags, historian data, specific PLC block information, or network traffic.

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Monitor Process State technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Monitor Process State
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Monitor Process State by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0801 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0816 Mitigation Limited or Not Effective
This type of attack technique cannot be easily mitigated with preventive controls since it is based on the abuse of system features.


## Detection

### Detection of Monitor Process State


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Monitor Process State technique applicable | Medium | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [MITRE ATT&CK ICS - T0801](https://attack.mitre.org/techniques/T0801)
