---
name: "T0837_loss-of-protection"
description: "Adversaries may compromise protective system functions designed to prevent the effects of faults and abnormal conditions."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0837
  - impact
technique_id: "T0837"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0837"
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

# T0837 Loss of Protection

## High-Level Description

Adversaries may compromise protective system functions designed to prevent the effects of faults and abnormal conditions. This can result in equipment damage, prolonged process disruptions and hazards to personnel. 

Many faults and abnormal conditions in process control happen too quickly for a human operator to react to. Speed is critical in correcting these conditions to limit serious impacts such as Loss of Control and Property Damage. 

Adversaries may target and disable protective system functions as a prerequisite to subsequent attack execution or to allow for future faults and abnormal conditions to go unchecked. Detection of a Loss of Protection by operators can result in the shutdown of a process due to strict policies regarding protection systems. This can cause a Loss of Productivity and Revenue and may meet the technical goals of adversaries seeking to cause process disruptions.

## Kill Chain Phase

- Impact (TA0105)

**Platforms:** ICS

## What to Check

- [ ] Identify if Loss of Protection technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Loss of Protection
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Loss of Protection by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0837 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Loss of Protection


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Loss of Protection technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [MITRE ATT&CK ICS - T0837](https://attack.mitre.org/techniques/T0837)
