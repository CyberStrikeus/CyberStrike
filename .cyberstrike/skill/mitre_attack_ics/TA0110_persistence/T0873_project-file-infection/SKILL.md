---
name: "T0873_project-file-infection"
description: "Adversaries may attempt to infect project files with malicious code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0873
  - persistence
technique_id: "T0873"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0873"
tech_stack:
  - ics
cwe_ids:
  - CWE-276
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0873 Project File Infection

## High-Level Description

Adversaries may attempt to infect project files with malicious code. These project files may consist of objects, program organization units, variables such as tags, documentation, and other configurations needed for PLC programs to function. Using built in functions of the engineering software, adversaries may be able to download an infected program to a PLC in the operating environment enabling further Execution and Persistence techniques.

Adversaries may export their own code into project files with conditions to execute at specific intervals. Malicious programs allow adversaries control of all aspects of the process enabled by the PLC. Once the project file is downloaded to a PLC the workstation device may be disconnected with the infected project file still executing.

## Kill Chain Phase

- Persistence (TA0110)

**Platforms:** ICS

## What to Check

- [ ] Identify if Project File Infection technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Project File Infection
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Project File Infection by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0873 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0922 Restrict File and Directory Permissions

Ensure permissions restrict project file access to only engineer and technician user groups and accounts.

### M0941 Encrypt Sensitive Information

When at rest, project files should be encrypted to prevent unauthorized changes.

### M0947 Audit

Review the integrity of project files to verify they have not been modified by adversary behavior. Verify a cryptographic hash for the file with a known trusted version, or look for other indicators of modification (e.g., timestamps).

### M0945 Code Signing

Allow for code signing of any project files stored at rest to prevent unauthorized tampering. Ensure the signing keys are not easily accessible on the same system.

## Detection

### Detection of Project File Infection

## Risk Assessment

| Finding                                     | Severity | Impact      |
| ------------------------------------------- | -------- | ----------- |
| Project File Infection technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Beckhoff](https://infosys.beckhoff.com/english.php?content=../content/1033/tc3_sourcecontrol/18014398915785483.html&id=)
- [Nicolas Falliere, Liam O Murchu, Eric Chien February 2011](https://docs.broadcom.com/doc/security-response-w32-stuxnet-dossier-11-en)
- [PLCdev](http://www.plcdev.com/book/export/html/373)
- [MITRE ATT&CK ICS - T0873](https://attack.mitre.org/techniques/T0873)
