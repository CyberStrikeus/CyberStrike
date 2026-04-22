---
name: "T0835_manipulate-io-image"
description: "Adversaries may manipulate the I/O image of PLCs through various means to prevent them from functioning as expected."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0835
  - inhibit-response-function
technique_id: "T0835"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0835"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0835 Manipulate I/O Image

## High-Level Description

Adversaries may manipulate the I/O image of PLCs through various means to prevent them from functioning as expected. Methods of I/O image manipulation may include overriding the I/O table via direct memory manipulation or using the override function used for testing PLC programs. During the scan cycle, a PLC reads the status of all inputs and stores them in an image table. The image table is the PLCs internal storage location where values of inputs/outputs for one scan are stored while it executes the user program. After the PLC has solved the entire logic program, it updates the output image table. The contents of this output image table are written to the corresponding output points in I/O Modules.

One of the unique characteristics of PLCs is their ability to override the status of a physical discrete input or to override the logic driving a physical output coil and force the output to a desired status.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Manipulate I/O Image technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Manipulate I/O Image
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Manipulate I/O Image by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0835 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0816 Mitigation Limited or Not Effective

This technique may not be effectively mitigated against, consider controls for assets and processes that lead to the use of this technique.

## Detection

### Detection of Manipulate I/O Image

## Risk Assessment

| Finding                                   | Severity | Impact                    |
| ----------------------------------------- | -------- | ------------------------- |
| Manipulate I/O Image technique applicable | High     | Inhibit Response Function |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Dr. Kelvin T. Erickson December 2010](https://www.scribd.com/document/458637574/Programmable-Logic-Controllers)
- [Nanjundaiah, Vaidyanath](https://www.ezautomation.net/industry-articles/plc-ladder-logic-basics.htm)
- [MITRE ATT&CK ICS - T0835](https://attack.mitre.org/techniques/T0835)
