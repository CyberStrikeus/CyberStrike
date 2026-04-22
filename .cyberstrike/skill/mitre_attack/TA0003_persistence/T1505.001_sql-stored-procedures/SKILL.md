---
name: "T1505.001_sql-stored-procedures"
description: "Adversaries may abuse SQL stored procedures to establish persistent access to systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1505.001
  - persistence
  - windows
  - linux
  - sub-technique
technique_id: "T1505.001"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1505/001"
tech_stack:
  - windows
  - linux
cwe_ids:
  - CWE-276
chains_with:
  - T1505
  - T1505.002
  - T1505.003
  - T1505.004
  - T1505.005
  - T1505.006
prerequisites:
  - T1505
severity_boost:
  T1505: "Chain with T1505 for deeper attack path"
  T1505.002: "Chain with T1505.002 for deeper attack path"
  T1505.003: "Chain with T1505.003 for deeper attack path"
---

# T1505.001 SQL Stored Procedures

> **Sub-technique of:** T1505

## High-Level Description

Adversaries may abuse SQL stored procedures to establish persistent access to systems. SQL Stored Procedures are code that can be saved and reused so that database users do not waste time rewriting frequently used SQL queries. Stored procedures can be invoked via SQL statements to the database using the procedure name or via defined events (e.g. when a SQL server application is started/restarted).

Adversaries may craft malicious stored procedures that can provide a persistence mechanism in SQL database servers. To execute operating system commands through SQL syntax the adversary may have to enable additional functionality, such as xp_cmdshell for MSSQL Server. 

Microsoft SQL Server can enable common language runtime (CLR) integration. With CLR integration enabled, application developers can write stored procedures using any .NET framework language (e.g. VB .NET, C#, etc.). Adversaries may craft or modify CLR assemblies that are linked to stored procedures since these CLR assemblies can be made to execute arbitrary commands.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Linux

## What to Check

- [ ] Identify if SQL Stored Procedures technique is applicable to target environment
- [ ] Check Windows systems for indicators of SQL Stored Procedures
- [ ] Check Linux systems for indicators of SQL Stored Procedures
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SQL Stored Procedures by examining the target platforms (Windows, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1505.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit
Regularly check component software on critical services that adversaries may target for persistence to verify the integrity of the systems and identify if unexpected changes have been made.

### M1045 Code Signing
Ensure all application component binaries are signed by the correct application developers.

### M1026 Privileged Account Management
Do not allow administrator accounts that have permissions to add component software on these services to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.


## Detection

### Detection Strategy for SQL Stored Procedures Abuse via T1505.001


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SQL Stored Procedures technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft CLR Integration 2017](https://docs.microsoft.com/en-us/sql/relational-databases/clr-integration/common-language-runtime-integration-overview?view=sql-server-2017)
- [Microsoft xp_cmdshell 2017](https://docs.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/xp-cmdshell-transact-sql?view=sql-server-2017)
- [Kaspersky MSSQL Aug 2019](https://securelist.com/malicious-tasks-in-ms-sql-server/92167/)
- [NetSPI Startup Stored Procedures](https://www.netspi.com/blog/technical-blog/network-penetration-testing/sql-server-persistence-part-1-startup-stored-procedures/)
- [NetSPI SQL Server CLR](https://www.netspi.com/blog/technical-blog/adversary-simulation/attacking-sql-server-clr-assemblies/)
- [Atomic Red Team - T1505.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1505.001)
- [MITRE ATT&CK - T1505.001](https://attack.mitre.org/techniques/T1505/001)
