---
name: "T0856_spoof-reporting-message"
description: "Adversaries may spoof reporting messages in control system environments for evasion and to impair process control."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0856
  - evasion
  - impair-process-control
technique_id: "T0856"
tactic: "evasion"
all_tactics:
  - evasion
  - impair-process-control
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0856"
tech_stack:
  - ics
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0856 Spoof Reporting Message

## High-Level Description

Adversaries may spoof reporting messages in control system environments for evasion and to impair process control. In control systems, reporting messages contain telemetry data (e.g., I/O values) pertaining to the current state of equipment and the industrial process. Reporting messages are important for monitoring the normal operation of a system or identifying important events such as deviations from expected values. 

If an adversary has the ability to Spoof Reporting Messages, they can impact the control system in many ways. The adversary can Spoof Reporting Messages that state that the process is operating normally, as a form of evasion. The adversary could also Spoof Reporting Messages to make the defenders and operators think that other errors are occurring in order to distract them from the actual source of a problem.

## Kill Chain Phase

- Evasion (TA0103)
- Impair Process Control (TA0106)

**Platforms:** ICS

## What to Check

- [ ] Identify if Spoof Reporting Message technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Spoof Reporting Message
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Spoof Reporting Message by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0856 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0813 Software Process and Device Authentication
Devices should authenticate all messages between master and outstation assets.

### M0802 Communication Authenticity
Protocols used for control functions should provide authenticity through MAC functions or digital signatures. If not, utilize bump-in-the-wire devices or VPNs to enforce communication authenticity between devices that are not capable of supporting this (e.g., legacy controllers, RTUs).

### M0930 Network Segmentation
Segment operational assets and their management devices based on their functional role within the process. Enabling more strict isolation to more critical control and operational information within the control environment.

### M0807 Network Allowlists
Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0937 Filter Network Traffic
Perform inline allowlisting of automation protocol commands to prevent devices from sending unauthorized command or reporting messages. Allow/denylist techniques need to be designed with sufficient accuracy to prevent the unintended blocking of valid reporting messages.


## Detection

### Detection of Spoof Reporting Message


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Spoof Reporting Message technique applicable | Medium | Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Bonnie Zhu, Anthony Joseph, Shankar Sastry 2011](http://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=6142258)
- [MITRE ATT&CK ICS - T0856](https://attack.mitre.org/techniques/T0856)
