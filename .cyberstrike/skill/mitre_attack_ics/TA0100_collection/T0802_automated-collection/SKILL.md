---
name: "T0802_automated-collection"
description: "Adversaries may automate collection of industrial environment information using tools or scripts."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0802
  - collection
technique_id: "T0802"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0802"
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

# T0802 Automated Collection

## High-Level Description

Adversaries may automate collection of industrial environment information using tools or scripts. This automated collection may leverage native control protocols and tools available in the control systems environment. For example, the OPC protocol may be used to enumerate and gather information. Access to a system or interface with these native protocols may allow collection and enumeration of other attached, communicating servers and devices.

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Automated Collection technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Automated Collection
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Automated Collection by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0802 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0807 Network Allowlists
Utilize network allowlists to restrict unnecessary connections to network devices (e.g., comm servers, serial to ethernet converters) and services, especially in cases when devices have limits on the number of simultaneous sessions they support.

### M0930 Network Segmentation
Prevent unauthorized systems from accessing control servers or field devices containing industrial information, especially services used for common automation protocols (e.g., DNP3, OPC).


## Detection

### Detection of Automated Collection


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Automated Collection technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [MITRE ATT&CK ICS - T0802](https://attack.mitre.org/techniques/T0802)
