---
name: "T1213.003_code-repositories"
description: "Adversaries may leverage code repositories to collect valuable information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1213.003
  - collection
  - saas
  - sub-technique
technique_id: "T1213.003"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1213/003"
tech_stack:
  - saas
cwe_ids:
  - CWE-200
chains_with:
  - T1213
  - T1213.001
  - T1213.002
  - T1213.004
  - T1213.005
  - T1213.006
prerequisites:
  - T1213
severity_boost:
  T1213: "Chain with T1213 for deeper attack path"
  T1213.001: "Chain with T1213.001 for deeper attack path"
  T1213.002: "Chain with T1213.002 for deeper attack path"
---

# T1213.003 Code Repositories

> **Sub-technique of:** T1213

## High-Level Description

Adversaries may leverage code repositories to collect valuable information. Code repositories are tools/services that store source code and automate software builds. They may be hosted internally or privately on third party sites such as Github, GitLab, SourceForge, and BitBucket. Users typically interact with code repositories through a web application or command-line utilities such as git.

Once adversaries gain access to a victim network or a private code repository, they may collect sensitive information such as proprietary source code or Unsecured Credentials contained within software's source code. Having access to software's source code may allow adversaries to develop Exploits, while credentials may provide access to additional resources using Valid Accounts.

**Note:** This is distinct from Code Repositories, which focuses on conducting Reconnaissance via public code repositories.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** SaaS

## What to Check

- [ ] Identify if Code Repositories technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Code Repositories
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Code Repositories by examining the target platforms (SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1213.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Develop and publish policies that define acceptable information to be stored in code repositories.

### M1047 Audit

Consider periodic reviews of accounts and privileges for critical and sensitive code repositories. Scan code repositories for exposed credentials or other sensitive information.

### M1018 User Account Management

Enforce the principle of least-privilege. Consider implementing access control mechanisms that include both authentication and authorization for code repositories.

### M1032 Multi-factor Authentication

Use multi-factor authentication for logons to code repositories.

## Detection

### Detecting Bulk or Anomalous Access to Private Code Repositories via SaaS Platforms

## Risk Assessment

| Finding                                | Severity | Impact     |
| -------------------------------------- | -------- | ---------- |
| Code Repositories technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Wired Uber Breach](https://www.wired.com/story/uber-paid-off-hackers-to-hide-a-57-million-user-data-breach/)
- [Krebs Adobe](https://krebsonsecurity.com/2013/10/adobe-to-announce-source-code-customer-data-breach/)
- [Atomic Red Team - T1213.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1213.003)
- [MITRE ATT&CK - T1213.003](https://attack.mitre.org/techniques/T1213/003)
