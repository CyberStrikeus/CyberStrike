---
name: "T0877_io-image"
description: "Adversaries may seek to capture process values related to the inputs and outputs of a PLC."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0877
  - collection
technique_id: "T0877"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0877"
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

# T0877 I/O Image

## High-Level Description

Adversaries may seek to capture process values related to the inputs and outputs of a PLC. During the scan cycle, a PLC reads the status of all inputs and stores them in an image table. The image table is the PLCs internal storage location where values of inputs/outputs for one scan are stored while it executes the user program. After the PLC has solved the entire logic program, it updates the output image table. The contents of this output image table are written to the corresponding output points in I/O Modules.

The Input and Output Image tables described above make up the I/O Image on a PLC. This image is used by the user program instead of directly interacting with physical I/O. 

Adversaries may collect the I/O Image state of a PLC by utilizing a devices Native API to access the memory regions directly. The collection of the PLCs I/O state could be used to replace values or inform future stages of an attack.

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if I/O Image technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of I/O Image
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to I/O Image by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0877 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0816 Mitigation Limited or Not Effective
This technique may not be effectively mitigated against, consider controls for assets and processes that lead to the use of this technique.


## Detection

### Detection of I/O Image


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| I/O Image technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Nanjundaiah, Vaidyanath](https://www.ezautomation.net/industry-articles/plc-ladder-logic-basics.htm)
- [Spenneberg, Ralf 2016](https://www.blackhat.com/docs/asia-16/materials/asia-16-Spenneberg-PLC-Blaster-A-Worm-Living-Solely-In-The-PLC.pdf)
- [MITRE ATT&CK ICS - T0877](https://attack.mitre.org/techniques/T0877)
