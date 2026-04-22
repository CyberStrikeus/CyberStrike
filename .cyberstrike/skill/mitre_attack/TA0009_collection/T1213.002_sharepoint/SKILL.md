---
name: "T1213.002_sharepoint"
description: "Adversaries may leverage the SharePoint repository as a source to mine valuable information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1213.002
  - collection
  - windows
  - office-suite
  - sub-technique
technique_id: "T1213.002"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1213/002"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-200
chains_with:
  - T1213
  - T1213.001
  - T1213.003
  - T1213.004
  - T1213.005
  - T1213.006
prerequisites:
  - T1213
severity_boost:
  T1213: "Chain with T1213 for deeper attack path"
  T1213.001: "Chain with T1213.001 for deeper attack path"
  T1213.003: "Chain with T1213.003 for deeper attack path"
---

# T1213.002 Sharepoint

> **Sub-technique of:** T1213

## High-Level Description

Adversaries may leverage the SharePoint repository as a source to mine valuable information. SharePoint will often contain useful information for an adversary to learn about the structure and functionality of the internal network and systems. For example, the following is a list of example information that may hold potential value to an adversary and may also be found on SharePoint:

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

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Sharepoint technique is applicable to target environment
- [ ] Check Windows systems for indicators of Sharepoint
- [ ] Check Office Suite systems for indicators of Sharepoint
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Sharepoint by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1213.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit
Consider periodic review of accounts and privileges for critical and sensitive SharePoint repositories.

### M1018 User Account Management
Enforce the principle of least-privilege. Consider implementing access control mechanisms that include both authentication and authorization.

### M1017 User Training
Develop and publish policies that define acceptable information to be stored in SharePoint repositories.


## Detection

### Detecting Abnormal SharePoint Data Mining by Privileged or Rare Users


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Sharepoint technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Microsoft SharePoint Logging](https://support.office.com/en-us/article/configure-audit-settings-for-a-site-collection-a9920c97-38c0-44f2-8bcb-4cf1e2ae22d2)
- [Atomic Red Team - T1213.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1213.002)
- [MITRE ATT&CK - T1213.002](https://attack.mitre.org/techniques/T1213/002)
