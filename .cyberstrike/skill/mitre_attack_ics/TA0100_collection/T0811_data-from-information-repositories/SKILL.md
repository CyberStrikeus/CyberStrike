---
name: "T0811_data-from-information-repositories"
description: "Adversaries may target and collect data from information repositories."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0811
  - collection
technique_id: "T0811"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0811"
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

# T0811 Data from Information Repositories

## High-Level Description

Adversaries may target and collect data from information repositories. This can include sensitive data such as specifications, schematics, or diagrams of control system layouts, devices, and processes. Examples of information repositories include reference databases in the process environment, as well as databases in the corporate network that might contain information about the ICS.

Information collected from these systems may provide the adversary with a better understanding of the operational environment, vendors used, processes, or procedures of the ICS.

In a campaign between 2011 and 2013 against ONG organizations, Chinese state-sponsored actors searched document repositories for specific information such as, system manuals, remote terminal unit (RTU) sites, personnel lists, documents that included the string SCAD*, user credentials, and remote dial-up access information.

## Kill Chain Phase

- Collection (TA0100)

**Platforms:** ICS

## What to Check

- [ ] Identify if Data from Information Repositories technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Data from Information Repositories
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Data from Information Repositories by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0811 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0947 Audit
Consider periodic reviews of accounts and privileges for critical and sensitive repositories.

### M0941 Encrypt Sensitive Information
Information which is sensitive to the operation and architecture of the process environment may be encrypted to ensure confidentiality and restrict access to only those who need to know.

### M0922 Restrict File and Directory Permissions
Protect files with proper permissions to limit opportunities for adversaries to interact and collect information from databases.

### M0918 User Account Management
Ensure users and user groups have appropriate permissions for their roles through Identity and Access Management (IAM) controls to prevent misuse. Implement user accounts for each individual that may access the repositories for role enforcement and non-repudiation of actions.

### M0926 Privileged Account Management
Minimize permissions and access for service accounts to limit the information that may be exposed or collected by malicious users or software.

### M0917 User Training
Develop and publish policies that define acceptable information to be stored in repositories.


## Detection

### Detection of Data from Information Repositories


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data from Information Repositories technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Cybersecurity & Infrastructure Security Agency March 2018](https://us-cert.cisa.gov/ncas/alerts/TA18-074A)
- [CISA AA21-201A Pipeline Intrusion July 2021](https://us-cert.cisa.gov/sites/default/files/publications/AA21-201A_Chinese_Gas_Pipeline_Intrusion_Campaign_2011_to_2013%20(1).pdf)
- [MITRE ATT&CK ICS - T0811](https://attack.mitre.org/techniques/T0811)
