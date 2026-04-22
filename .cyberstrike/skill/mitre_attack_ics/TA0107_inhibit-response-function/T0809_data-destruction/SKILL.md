---
name: "T0809_data-destruction"
description: "Adversaries may perform data destruction over the course of an operation."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0809
  - inhibit-response-function
technique_id: "T0809"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0809"
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

# T0809 Data Destruction

## High-Level Description

Adversaries may perform data destruction over the course of an operation. The adversary may drop or create malware, tools, or other non-native files on a target system to accomplish this, potentially leaving behind traces of malicious activities. Such non-native files and other data may be removed over the course of an intrusion to maintain a small footprint or as a standard part of the post-intrusion cleanup process. 

Data destruction may also be used to render operator interfaces unable to respond and to disrupt response functions from occurring as expected. An adversary may also destroy data backups that are vital to recovery after an incident.

Standard file deletion commands are available on most operating system and device interfaces to perform cleanup, but adversaries may use other tools as well. Two examples are Windows Sysinternals SDelete and Active@ Killdisk.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Data Destruction technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Data Destruction
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Data Destruction by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0809 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0922 Restrict File and Directory Permissions
Protect files stored locally with proper permissions to limit opportunities for adversaries to impact data storage.

### M0953 Data Backup
Utilize central storage servers for critical operations where possible (e.g., historians) and keep remote backups. For outstations, use local redundant storage for event recorders. Have backup control system platforms, preferably as hot-standbys to respond immediately to data destruction events.

### M0926 Privileged Account Management
Minimize permissions and access for service accounts to limit the information that may be impacted by malicious users or software.


## Detection

### Detection of Data Destruction


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data Destruction technique applicable | High | Inhibit Response Function |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Enterprise ATT&CK January 2018](https://attack.mitre.org/wiki/Technique/T1107)
- [MITRE ATT&CK ICS - T0809](https://attack.mitre.org/techniques/T0809)
