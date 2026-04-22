---
name: "T1597_search-closed-sources"
description: "Adversaries may search and gather information about victims from closed (e.g., paid, private, or otherwise not freely available) sources that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1597
  - reconnaissance
  - pre
technique_id: "T1597"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1597"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1597.001
  - T1597.002
prerequisites: []
severity_boost:
  T1597.001: "Chain with T1597.001 for deeper attack path"
  T1597.002: "Chain with T1597.002 for deeper attack path"
---

# T1597 Search Closed Sources

## High-Level Description

Adversaries may search and gather information about victims from closed (e.g., paid, private, or otherwise not freely available) sources that can be used during targeting. Information about victims may be available for purchase from reputable private sources and databases, such as paid subscriptions to feeds of technical/threat intelligence data. Adversaries may also purchase information from less-reputable sources such as dark web or cybercrime blackmarkets.

Adversaries may search in different closed databases depending on what information they seek to gather. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Websites/Domains), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: External Remote Services or Valid Accounts).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Search Closed Sources technique is applicable to target environment
- [ ] Check PRE systems for indicators of Search Closed Sources
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Search Closed Sources by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1597 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Search Closed Sources

## Risk Assessment

| Finding                                    | Severity | Impact         |
| ------------------------------------------ | -------- | -------------- |
| Search Closed Sources technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ZDNET Selling Data](https://www.zdnet.com/article/a-hacker-group-is-selling-more-than-73-million-user-records-on-the-dark-web/)
- [Atomic Red Team - T1597](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1597)
- [MITRE ATT&CK - T1597](https://attack.mitre.org/techniques/T1597)
