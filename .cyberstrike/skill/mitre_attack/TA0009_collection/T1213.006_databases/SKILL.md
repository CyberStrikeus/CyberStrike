---
name: "T1213.006_databases"
description: "Adversaries may leverage databases to mine valuable information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1213.006
  - collection
  - linux
  - windows
  - macos
  - iaas
  - saas
  - sub-technique
technique_id: "T1213.006"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - Windows
  - macOS
  - IaaS
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1213/006"
tech_stack:
  - linux
  - windows
  - macos
  - cloud
  - saas
cwe_ids:
  - CWE-200
chains_with:
  - T1213
  - T1213.001
  - T1213.002
  - T1213.003
  - T1213.004
  - T1213.005
prerequisites:
  - T1213
severity_boost:
  T1213: "Chain with T1213 for deeper attack path"
  T1213.001: "Chain with T1213.001 for deeper attack path"
  T1213.002: "Chain with T1213.002 for deeper attack path"
---

# T1213.006 Databases

> **Sub-technique of:** T1213

## High-Level Description

Adversaries may leverage databases to mine valuable information. These databases may be hosted on-premises or in the cloud (both in platform-as-a-service and software-as-a-service environments). 

Examples of databases from which information may be collected include MySQL, PostgreSQL, MongoDB, Amazon Relational Database Service, Azure SQL Database, Google Firebase, and Snowflake. Databases may include a variety of information of interest to adversaries, such as usernames, hashed passwords, personally identifiable information, and financial data. Data collected from databases may be used for Lateral Movement, Command and Control, or Exfiltration. Data exfiltrated from databases may also be used to extort victims or may be sold for profit.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, Windows, macOS, IaaS, SaaS

## What to Check

- [ ] Identify if Databases technique is applicable to target environment
- [ ] Check Linux systems for indicators of Databases
- [ ] Check Windows systems for indicators of Databases
- [ ] Check macOS systems for indicators of Databases
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Databases by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1213.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training
Develop and publish policies that define acceptable information to be stored in databases and acceptable handling of customer data. Only store information required for business operations.

### M1041 Encrypt Sensitive Information
Encrypt data stored at rest in databases.

### M1054 Software Configuration
Consider implementing data retention policies to automate periodically archiving and/or deleting data that is no longer needed.

### M1018 User Account Management
Enforce the principle of least-privilege. Consider implementing access control mechanisms that include both authentication and authorization.

### M1047 Audit
Consider periodic review of accounts and privileges for critical and sensitive databases.


## Detection

### Suspicious Database Access and Dump Activity Across Environments (T1213.006)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Databases technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Google Cloud Threat Intelligence UNC5537 Snowflake 2024](https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion)
- [Atomic Red Team - T1213.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1213.006)
- [MITRE ATT&CK - T1213.006](https://attack.mitre.org/techniques/T1213/006)
