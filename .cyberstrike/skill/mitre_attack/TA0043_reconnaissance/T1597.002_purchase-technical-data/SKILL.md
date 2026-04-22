---
name: "T1597.002_purchase-technical-data"
description: "Adversaries may purchase technical information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1597.002
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1597.002"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1597/002"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1597
  - T1597.001
prerequisites:
  - T1597
severity_boost:
  T1597: "Chain with T1597 for deeper attack path"
  T1597.001: "Chain with T1597.001 for deeper attack path"
---

# T1597.002 Purchase Technical Data

> **Sub-technique of:** T1597

## High-Level Description

Adversaries may purchase technical information about victims that can be used during targeting. Information about victims may be available for purchase within reputable private sources and databases, such as paid subscriptions to feeds of scan databases or other data aggregation services. Adversaries may also purchase information from less-reputable sources such as dark web or cybercrime blackmarkets.

Adversaries may purchase information about their already identified targets, or use purchased data to discover opportunities for successful breaches. Threat actors may gather various technical details from purchased data, including but not limited to employee contact information, credentials, or specifics regarding a victim’s infrastructure. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Websites/Domains), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: External Remote Services or Valid Accounts).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Purchase Technical Data technique is applicable to target environment
- [ ] Check PRE systems for indicators of Purchase Technical Data
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Purchase Technical Data by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1597.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of Purchase Technical Data


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Purchase Technical Data technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [ZDNET Selling Data](https://www.zdnet.com/article/a-hacker-group-is-selling-more-than-73-million-user-records-on-the-dark-web/)
- [Atomic Red Team - T1597.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1597.002)
- [MITRE ATT&CK - T1597.002](https://attack.mitre.org/techniques/T1597/002)
