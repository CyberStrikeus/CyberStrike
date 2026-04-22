---
name: "T1593.003_code-repositories"
description: "Adversaries may search public code repositories for information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1593.003
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1593.003"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1593/003"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1593
  - T1593.001
  - T1593.002
prerequisites:
  - T1593
severity_boost:
  T1593: "Chain with T1593 for deeper attack path"
  T1593.001: "Chain with T1593.001 for deeper attack path"
  T1593.002: "Chain with T1593.002 for deeper attack path"
---

# T1593.003 Code Repositories

> **Sub-technique of:** T1593

## High-Level Description

Adversaries may search public code repositories for information about victims that can be used during targeting. Victims may store code in repositories on various third-party websites such as GitHub, GitLab, SourceForge, and BitBucket. Users typically interact with code repositories through a web application or command-line utilities such as git. 

Adversaries may search various public code repositories for various information about a victim. Public code repositories can often be a source of various general information about victims, such as commonly used programming languages and libraries as well as the names of employees. Adversaries may also identify more sensitive data, including accidentally leaked credentials or API keys. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information), establishing operational resources (ex: Compromise Accounts or Compromise Infrastructure), and/or initial access (ex: Valid Accounts or Phishing). 

**Note:** This is distinct from Code Repositories, which focuses on Collection from private and internally hosted code repositories.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Code Repositories technique is applicable to target environment
- [ ] Check PRE systems for indicators of Code Repositories
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Code Repositories by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1593.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1013 Application Developer Guidance
Application developers uploading to public code repositories should be careful to avoid publishing sensitive information such as credentials and API keys.

### M1047 Audit
Scan public code repositories for exposed credentials or other sensitive information before making commits. Ensure that any leaked credentials are removed from the commit history, not just the current latest version of the code.


## Detection

### Detection of Code Repositories


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Code Repositories technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [GitHub Cloud Service Credentials](https://www.forbes.com/sites/runasandvik/2014/01/14/attackers-scrape-github-for-cloud-service-credentials-hijack-account-to-mine-virtual-currency/)
- [Atomic Red Team - T1593.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1593.003)
- [MITRE ATT&CK - T1593.003](https://attack.mitre.org/techniques/T1593/003)
