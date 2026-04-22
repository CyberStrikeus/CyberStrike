---
name: "T0868_detect-operating-mode"
description: "Adversaries may gather information about a PLCs or controllers current operating mode."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0868
  - collection
technique_id: "T0868"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0868"
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

# T0868 Detect Operating Mode

## High-Level Description

Adversaries may gather information about a PLCs or controllers current operating mode. Operating modes dictate what change or maintenance functions can be manipulated and are often controlled by a key switch on the PLC (e.g., run, prog [program], and remote). Knowledge of these states may be valuable to an adversary to determine if they are able to reprogram the PLC. Operating modes and the mechanisms by which they are selected often vary by vendor and product line. Some commonly implemented operating modes are described below: 

* Program - This mode must be enabled before changes can be made to a devices program. This allows program uploads and downloads between the device and an engineering workstation. Often the PLCs logic Is halted, and all outputs may be forced off. 
* Run - Execution of the devices program occurs in this mode. Input and output (values, points, tags, elements, etc.) are monitored and used according to the programs logic.Program Upload and Program Download are disabled while in this mode. 
* Remote - Allows for remote changes to a PLCs operation mode. 
* Stop - The PLC and program is stopped, while in this mode, outputs are forced off. 
* Reset - Conditions on the PLC are reset to their original states. Warm resets may retain some memory while cold resets will reset all I/O and data registers. 
* Test / Monitor mode - Similar to run mode, I/O is processed, although this mode allows for monitoring, force set, resets, and more generally tuning or debugging of the system. Often monitor mode may be used as a trial for initialization.

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Detect Operating Mode technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Detect Operating Mode
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Detect Operating Mode by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0868 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0813 Software Process and Device Authentication
Authenticate connections from software and devices to prevent unauthorized systems from accessing protected management functions.

### M0804 Human User Authentication
All field controllers should require users to authenticate for all remote or local management sessions. The authentication mechanisms should also support Account Use Policies, Password Policies, and User Account Management.

### M0937 Filter Network Traffic
Perform inline allowlisting of automation protocol commands to prevent devices from sending unauthorized command or reporting messages. Allow/denylist techniques need to be designed with sufficient accuracy to prevent the unintended blocking of valid messages.

### M0801 Access Management
Authenticate all access to field controllers before authorizing access to, or modification of, a device's state, logic, or programs. Centralized authentication techniques can help manage the large number of field controller accounts needed across the ICS.

### M0802 Communication Authenticity
Protocols used for control functions should provide authenticity through MAC functions or digital signatures. If not, utilize bump-in-the-wire devices or VPNs to enforce communication authenticity between devices that are not capable of supporting this (e.g., legacy controllers, RTUs).

### M0807 Network Allowlists
Use host-based allowlists to prevent devices from accepting connections from unauthorized systems. For example, allowlists can be used to ensure devices can only connect with master stations or known management/engineering workstations.

### M0800 Authorization Enforcement
All field controllers should restrict the modification of programs to only certain users (e.g., engineers, field technician), preferably through implementing a role-based access mechanism.

### M0930 Network Segmentation
Segment operational network and systems to restrict access to critical system functions to predetermined management systems.


## Detection

### Detection of Detect Operating Mode


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Detect Operating Mode technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Machine Information Systems 2007](http://www.machine-information-systems.com/How_PLCs_Work.html)
- [N.A. October 2017](https://forumautomation.com/t/what-are-the-different-operating-modes-in-plc/2489)
- [Omron](https://www.omron-ap.com/service_support/FAQ/FAQ00002/index.asp#:~:text=In%20PROGRAM%20mode%2C%20the%20CPU,can%20be%20created%20or%20modified.)
- [PLCgurus 2021](https://www.plcgurus.net/plc-basics/)
- [MITRE ATT&CK ICS - T0868](https://attack.mitre.org/techniques/T0868)
