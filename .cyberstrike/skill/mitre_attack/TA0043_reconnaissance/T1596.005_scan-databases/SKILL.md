---
name: "T1596.005_scan-databases"
description: "Adversaries may search within public scan databases for information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1596.005
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1596.005"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1596/005"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1596
  - T1596.001
  - T1596.002
  - T1596.003
  - T1596.004
prerequisites:
  - T1596
severity_boost:
  T1596: "Chain with T1596 for deeper attack path"
  T1596.001: "Chain with T1596.001 for deeper attack path"
  T1596.002: "Chain with T1596.002 for deeper attack path"
---

# T1596.005 Scan Databases

> **Sub-technique of:** T1596

## High-Level Description

Adversaries may search within public scan databases for information about victims that can be used during targeting. Various online services continuously publish the results of Internet scans/surveys, often harvesting information such as active IP addresses, hostnames, open ports, certificates, and even server banners.

Adversaries may search scan databases to gather actionable information. Threat actors can use online resources and lookup tools to harvest information from these services. Adversaries may seek information about their already identified targets, or use these datasets to discover opportunities for successful breaches. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Active Scanning or Search Open Websites/Domains), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: External Remote Services or Exploit Public-Facing Application).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Scan Databases technique is applicable to target environment
- [ ] Check PRE systems for indicators of Scan Databases
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Scan Databases by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1596.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Scan Databases

## Risk Assessment

| Finding                             | Severity | Impact         |
| ----------------------------------- | -------- | -------------- |
| Scan Databases technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Shodan](https://shodan.io)
- [Atomic Red Team - T1596.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1596.005)
- [MITRE ATT&CK - T1596.005](https://attack.mitre.org/techniques/T1596/005)
