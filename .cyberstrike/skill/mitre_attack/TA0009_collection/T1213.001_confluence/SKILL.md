---
name: "T1213.001_confluence"
description: "Adversaries may leverage Confluence repositories to mine valuable information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1213.001
  - collection
  - saas
  - sub-technique
technique_id: "T1213.001"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1213/001"
tech_stack:
  - saas
cwe_ids:
  - CWE-200
chains_with:
  - T1213
  - T1213.002
  - T1213.003
  - T1213.004
  - T1213.005
  - T1213.006
prerequisites:
  - T1213
severity_boost:
  T1213: "Chain with T1213 for deeper attack path"
  T1213.002: "Chain with T1213.002 for deeper attack path"
  T1213.003: "Chain with T1213.003 for deeper attack path"
---

# T1213.001 Confluence

> **Sub-technique of:** T1213

## High-Level Description

Adversaries may leverage Confluence repositories to mine valuable information. Often found in development environments alongside Atlassian JIRA, Confluence is generally used to store development-related documentation, however, in general may contain more diverse categories of useful information, such as:

* Policies, procedures, and standards
* Physical / logical network diagrams
* System architecture diagrams
* Technical system documentation
* Testing / development credentials (i.e., Unsecured Credentials)
* Work / project schedules
* Source code snippets
* Links to network shares and other internal resources

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** SaaS

## What to Check

- [ ] Identify if Confluence technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Confluence
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Confluence by examining the target platforms (SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1213.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training
Develop and publish policies that define acceptable information to be stored in Confluence repositories.

### M1047 Audit
Consider periodic review of accounts and privileges for critical and sensitive Confluence repositories.

### M1018 User Account Management
Enforce the principle of least-privilege. Consider implementing access control mechanisms that include both authentication and authorization.


## Detection

### Programmatic and Excessive Access to Confluence Documentation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Confluence technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Atlassian Confluence Logging](https://confluence.atlassian.com/confkb/how-to-enable-user-access-logging-182943.html)
- [Atomic Red Team - T1213.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1213.001)
- [MITRE ATT&CK - T1213.001](https://attack.mitre.org/techniques/T1213/001)
