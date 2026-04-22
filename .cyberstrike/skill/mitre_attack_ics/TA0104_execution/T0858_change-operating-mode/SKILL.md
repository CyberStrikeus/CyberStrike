---
name: "T0858_change-operating-mode"
description: "Adversaries may change the operating mode of a controller to gain additional access to engineering functions such as Program Download."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0858
  - execution
  - evasion
technique_id: "T0858"
tactic: "execution"
all_tactics:
  - execution
  - evasion
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0858"
tech_stack:
  - ics
cwe_ids:
  - CWE-94
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0858 Change Operating Mode

## High-Level Description

Adversaries may change the operating mode of a controller to gain additional access to engineering functions such as Program Download. Programmable controllers typically have several modes of operation that control the state of the user program and control access to the controllers API. Operating modes can be physically selected using a key switch on the face of the controller but may also be selected with calls to the controllers API. Operating modes and the mechanisms by which they are selected often vary by vendor and product line. Some commonly implemented operating modes are described below: 

* Program - This mode must be enabled before changes can be made to a devices program. This allows program uploads and downloads between the device and an engineering workstation. Often the PLCs logic Is halted, and all outputs may be forced off. 
* Run - Execution of the devices program occurs in this mode. Input and output (values, points, tags, elements, etc.) are monitored and used according to the programs logic. Program Upload and Program Download are disabled while in this mode. 
* Remote - Allows for remote changes to a PLCs operation mode. 
* Stop - The PLC and program is stopped, while in this mode, outputs are forced off. 
* Reset - Conditions on the PLC are reset to their original states. Warm resets may retain some memory while cold resets will reset all I/O and data registers. 
* Test / Monitor mode - Similar to run mode, I/O is processed, although this mode allows for monitoring, force set, resets, and more generally tuning or debugging of the system. Often monitor mode may be used as a trial for initialization.

## Kill Chain Phase

- Execution (TA0104)
- Evasion (TA0103)

**Platforms:** ICS

## What to Check

- [ ] Identify if Change Operating Mode technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Change Operating Mode
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Change Operating Mode by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0858 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0802 Communication Authenticity
Protocols used for device management should authenticate all network messages to prevent unauthorized system changes.

### M0804 Human User Authentication
All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0813 Software Process and Device Authentication
Authenticate connections fromsoftware and devices to prevent unauthorized systems from accessing protected management functions.

### M0801 Access Management
Authenticate all access to field controllers before authorizing access to, or modification of, a device's state, logic, or programs. Centralized authentication techniques can help manage the large number of field controller accounts needed across the ICS.

### M0807 Network Allowlists
Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0930 Network Segmentation
Segment operational network and systems to restrict access to critical system functions to predetermined management systems.

### M0800 Authorization Enforcement
All field controllers should restrict operating mode changes to only required authenticated users (e.g., engineers, field technicians), preferably through implementing a role-based access mechanism. Further, physical mechanisms (e.g., keys) can also be used to limit unauthorized operating mode changes.


## Detection

### Detection of Change Operating Mode


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Change Operating Mode technique applicable | Medium | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Machine Information Systems 2007](http://www.machine-information-systems.com/How_PLCs_Work.html)
- [N.A. October 2017](https://forumautomation.com/t/what-are-the-different-operating-modes-in-plc/2489)
- [Omron](https://www.omron-ap.com/service_support/FAQ/FAQ00002/index.asp#:~:text=In%20PROGRAM%20mode%2C%20the%20CPU,can%20be%20created%20or%20modified.)
- [PLCgurus 2021](https://www.plcgurus.net/plc-basics/)
- [MITRE ATT&CK ICS - T0858](https://attack.mitre.org/techniques/T0858)
