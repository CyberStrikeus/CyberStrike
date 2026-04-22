---
name: "T1593.002_search-engines"
description: "Adversaries may use search engines to collect information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1593.002
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1593.002"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1593/002"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1593
  - T1593.001
  - T1593.003
prerequisites:
  - T1593
severity_boost:
  T1593: "Chain with T1593 for deeper attack path"
  T1593.001: "Chain with T1593.001 for deeper attack path"
  T1593.003: "Chain with T1593.003 for deeper attack path"
---

# T1593.002 Search Engines

> **Sub-technique of:** T1593

## High-Level Description

Adversaries may use search engines to collect information about victims that can be used during targeting. Search engine services typical crawl online sites to index context and may provide users with specialized syntax to search for specific keywords or specific types of content (i.e. filetypes).

Adversaries may craft various search engine queries depending on what information they seek to gather. Threat actors may use search engines to harvest general information about victims, as well as use specialized queries to look for spillages/leaks of sensitive information such as network details or credentials. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Technical Databases), establishing operational resources (ex: Establish Accounts or Compromise Accounts), and/or initial access (ex: Valid Accounts or Phishing).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Search Engines technique is applicable to target environment
- [ ] Check PRE systems for indicators of Search Engines
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Search Engines by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1593.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of Search Engines


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Search Engines technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [SecurityTrails Google Hacking](https://www.recordedfuture.com/threat-intelligence-101/threat-analysis-techniques/google-dorks)
- [ExploitDB GoogleHacking](https://www.exploit-db.com/google-hacking-database)
- [Atomic Red Team - T1593.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1593.002)
- [MITRE ATT&CK - T1593.002](https://attack.mitre.org/techniques/T1593/002)
