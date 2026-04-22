---
name: "T1597.001_threat-intel-vendors"
description: "Adversaries may search private data from threat intelligence vendors for information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1597.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1597.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1597/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1597
  - T1597.002
prerequisites:
  - T1597
severity_boost:
  T1597: "Chain with T1597 for deeper attack path"
  T1597.002: "Chain with T1597.002 for deeper attack path"
---

# T1597.001 Threat Intel Vendors

> **Sub-technique of:** T1597

## High-Level Description

Adversaries may search private data from threat intelligence vendors for information that can be used during targeting. Threat intelligence vendors may offer paid feeds or portals that offer more data than what is publicly reported. Although sensitive details (such as customer names and other identifiers) may be redacted, this information may contain trends regarding breaches such as target industries, attribution claims, and successful TTPs/countermeasures.

Adversaries may search in private threat intelligence vendor data to gather actionable information. If a threat actor is searching for information on their own activities, that falls under Search Threat Vendor Data. Information reported by vendors may also reveal opportunities other forms of reconnaissance (ex: Search Open Websites/Domains), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: Exploit Public-Facing Application or External Remote Services).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Threat Intel Vendors technique is applicable to target environment
- [ ] Check PRE systems for indicators of Threat Intel Vendors
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Threat Intel Vendors by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1597.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of Threat Intel Vendors


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Threat Intel Vendors technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [D3Secutrity CTI Feeds](https://d3security.com/blog/10-of-the-best-open-source-threat-intelligence-feeds/)
- [Atomic Red Team - T1597.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1597.001)
- [MITRE ATT&CK - T1597.001](https://attack.mitre.org/techniques/T1597/001)
