---
name: "T0806_brute-force-io"
description: "Adversaries may repetitively or successively change I/O point values to perform an action."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0806
  - impair-process-control
technique_id: "T0806"
tactic: "impair-process-control"
all_tactics:
  - impair-process-control
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0806"
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

# T0806 Brute Force I/O

## High-Level Description

Adversaries may repetitively or successively change I/O point values to perform an action. Brute Force I/O may be achieved by changing either a range of I/O point values or a single point value repeatedly to manipulate a process function. The adversary's goal and the information they have about the target environment will influence which of the options they choose. In the case of brute forcing a range of point values, the adversary may be able to achieve an impact without targeting a specific point. In the case where a single point is targeted, the adversary may be able to generate instability on the process function associated with that particular point. 

Adversaries may use Brute Force I/O to cause failures within various industrial processes. These failures could be the result of wear on equipment or damage to downstream equipment.

## Kill Chain Phase

- Impair Process Control (TA0106)

**Platforms:** ICS

## What to Check

- [ ] Identify if Brute Force I/O technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Brute Force I/O
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Brute Force I/O by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0806 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0807 Network Allowlists
Utilize network allowlists to restrict unnecessary connections to network devices (e.g., comm servers, serial to ethernet converters) and services, especially in cases when devices have limits on the number of simultaneous sessions they support.

### M0930 Network Segmentation
Segment operational assets and their management devices based on their functional role within the process. Enabling more strict isolation to more critical control and operational information within the control environment.

### M0937 Filter Network Traffic
Allow/denylists can be used to block access when excessive I/O connections are detected from a system or device during a specified time period.

### M0813 Software Process and Device Authentication
Devices should authenticate all messages between master and outstation assets.


## Detection

### Detection of Brute Force I/O


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Brute Force I/O technique applicable | High | Impair Process Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [MITRE ATT&CK ICS - T0806](https://attack.mitre.org/techniques/T0806)
