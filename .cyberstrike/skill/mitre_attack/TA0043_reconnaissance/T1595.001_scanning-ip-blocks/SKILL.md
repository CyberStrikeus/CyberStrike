---
name: "T1595.001_scanning-ip-blocks"
description: "Adversaries may scan victim IP blocks to gather information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1595.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1595.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1595/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1595
  - T1595.002
  - T1595.003
prerequisites:
  - T1595
severity_boost:
  T1595: "Chain with T1595 for deeper attack path"
  T1595.002: "Chain with T1595.002 for deeper attack path"
  T1595.003: "Chain with T1595.003 for deeper attack path"
---

# T1595.001 Scanning IP Blocks

> **Sub-technique of:** T1595

## High-Level Description

Adversaries may scan victim IP blocks to gather information that can be used during targeting. Public IP addresses may be allocated to organizations by block, or a range of sequential addresses.

Adversaries may scan IP blocks in order to Gather Victim Network Information, such as which IP addresses are actively in use as well as more detailed information about hosts assigned these addresses. Scans may range from simple pings (ICMP requests and responses) to more nuanced scans that may reveal host software/versions via server banners or other network artifacts. Information from these scans may reveal opportunities for other forms of reconnaissance (ex: Search Open Websites/Domains or Search Open Technical Databases), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: External Remote Services).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Scanning IP Blocks technique is applicable to target environment
- [ ] Check PRE systems for indicators of Scanning IP Blocks
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Scanning IP Blocks by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1595.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of Scanning IP Blocks


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Scanning IP Blocks technique applicable | Low | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Botnet Scan](https://www.caida.org/publications/papers/2012/analysis_slash_zero/analysis_slash_zero.pdf)
- [Atomic Red Team - T1595.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1595.001)
- [MITRE ATT&CK - T1595.001](https://attack.mitre.org/techniques/T1595/001)
