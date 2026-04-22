---
name: "T0893_data-from-local-system"
description: "Adversaries may target and collect data from local system sources, such as file systems, configuration files, or local databases."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0893
  - collection
technique_id: "T0893"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0893"
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

# T0893 Data from Local System

## High-Level Description

Adversaries may target and collect data from local system sources, such as file systems, configuration files, or local databases. This can include sensitive data such as specifications, schematics, or diagrams of control system layouts, devices, and processes.

Adversaries may do this using Command-Line Interface or Scripting techniques to interact with the file system to gather information. Adversaries may also use Automated Collection on the local system.

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Data from Local System technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Data from Local System
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Data from Local System by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0893 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0941 Encrypt Sensitive Information
Information which is sensitive to the operation and architecture of the process environment may be encrypted to ensure confidentiality and restrict access to only those who need to know.

### M0803 Data Loss Prevention
Data loss prevention can restrict access to sensitive data and detect sensitive data that is unencrypted.

### M0922 Restrict File and Directory Permissions
Protect files stored locally with proper permissions to limit opportunities for adversaries to interact and collect information from the local system.

### M0917 User Training
Develop and publish policies that define acceptable information to be stored on local systems.


## Detection

### Detection of Data from Local System


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data from Local System technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [MITRE ATT&CK ICS - T0893](https://attack.mitre.org/techniques/T0893)
