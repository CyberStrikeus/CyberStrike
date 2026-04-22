---
name: "T0880_loss-of-safety"
description: "Adversaries may compromise safety system functions designed to maintain safe operation of a process when unacceptable or dangerous conditions occur."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0880
  - impact
technique_id: "T0880"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0880"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0880 Loss of Safety

## High-Level Description

Adversaries may compromise safety system functions designed to maintain safe operation of a process when unacceptable or dangerous conditions occur. Safety systems are often composed of the same elements as control systems but have the sole purpose of ensuring the process fails in a predetermined safe manner.

Many unsafe conditions in process control happen too quickly for a human operator to react to. Speed is critical in correcting these conditions to limit serious impacts such as Loss of Control and Property Damage.

Adversaries may target and disable safety system functions as a prerequisite to subsequent attack execution or to allow for future unsafe conditionals to go unchecked. Detection of a Loss of Safety by operators can result in the shutdown of a process due to strict policies regarding safety systems. This can cause a Loss of Productivity and Revenue and may meet the technical goals of adversaries seeking to cause process disruptions.

## Kill Chain Phase

- Impact (TA0105)

**Platforms:** ICS

## What to Check

- [ ] Identify if Loss of Safety technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Loss of Safety
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Loss of Safety by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0880 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0812 Safety Instrumented Systems

Ensure that all SIS are segmented from operational networks to prevent them from being targeted by additional adversarial behavior.

### M0805 Mechanical Protection Layers

Protection devices should have minimal digital components to prevent exposure to related adversarial techniques. Examples include interlocks, rupture disks, release valves, etc.

## Detection

### Detection of Loss of Safety

## Risk Assessment

| Finding                             | Severity | Impact |
| ----------------------------------- | -------- | ------ |
| Loss of Safety technique applicable | High     | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [MITRE ATT&CK ICS - T0880](https://attack.mitre.org/techniques/T0880)
