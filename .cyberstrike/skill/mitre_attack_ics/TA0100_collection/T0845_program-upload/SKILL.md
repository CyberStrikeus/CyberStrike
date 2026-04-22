---
name: "T0845_program-upload"
description: "Adversaries may attempt to upload a program from a PLC to gather information about an industrial process."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0845
  - collection
technique_id: "T0845"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0845"
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

# T0845 Program Upload

## High-Level Description

Adversaries may attempt to upload a program from a PLC to gather information about an industrial process. Uploading a program may allow them to acquire and study the underlying logic. Methods of program upload include vendor software, which enables the user to upload and read a program running on a PLC. This software can be used to upload the target program to a workstation, jump box, or an interfacing device.

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Program Upload technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Program Upload
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Program Upload by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0845 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0813 Software Process and Device Authentication
Authenticate connections from software and devices to prevent unauthorized systems from accessing protected management functions.

### M0802 Communication Authenticity
Protocols used for device management should authenticate all network messages to prevent unauthorized system changes.

### M0800 Authorization Enforcement
All field controllers should restrict program uploads to only certain users (e.g., engineers, field technician), preferably through implementing a role-based access mechanism.

### M0801 Access Management
Authenticate all access to field controllers before authorizing access to, or modification of, a device's state, logic, or programs. Centralized authentication techniques can help manage the large number of field controller accounts needed across the ICS.

### M0930 Network Segmentation
Segment operational network and systems to restrict access to critical system functions to predetermined management systems.

### M0937 Filter Network Traffic
Filter for protocols and payloads associated with program upload activity to prevent unauthorized access to device configurations.

### M0807 Network Allowlists
Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0804 Human User Authentication
All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.


## Detection

### Detection of Program Upload


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Program Upload technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [MITRE ATT&CK ICS - T0845](https://attack.mitre.org/techniques/T0845)
