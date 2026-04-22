---
name: "T1596.004_cdns"
description: "Adversaries may search content delivery network (CDN) data about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1596.004
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1596.004"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1596/004"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1596
  - T1596.001
  - T1596.002
  - T1596.003
  - T1596.005
prerequisites:
  - T1596
severity_boost:
  T1596: "Chain with T1596 for deeper attack path"
  T1596.001: "Chain with T1596.001 for deeper attack path"
  T1596.002: "Chain with T1596.002 for deeper attack path"
---

# T1596.004 CDNs

> **Sub-technique of:** T1596

## High-Level Description

Adversaries may search content delivery network (CDN) data about victims that can be used during targeting. CDNs allow an organization to host content from a distributed, load balanced array of servers. CDNs may also allow organizations to customize content delivery based on the requestor’s geographical region.

Adversaries may search CDN data to gather actionable information. Threat actors can use online resources and lookup tools to harvest information about content servers within a CDN. Adversaries may also seek and target CDN misconfigurations that leak sensitive information not intended to be hosted and/or do not have the same protection mechanisms (ex: login portals) as the content hosted on the organization’s website. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Active Scanning or Search Open Websites/Domains), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: Drive-by Compromise).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if CDNs technique is applicable to target environment
- [ ] Check PRE systems for indicators of CDNs
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to CDNs by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1596.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of CDNs


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| CDNs technique applicable | Low | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [DigitalShadows CDN](https://www.digitalshadows.com/blog-and-research/content-delivery-networks-cdns-can-leave-you-exposed-how-you-might-be-affected-and-what-you-can-do-about-it/)
- [Atomic Red Team - T1596.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1596.004)
- [MITRE ATT&CK - T1596.004](https://attack.mitre.org/techniques/T1596/004)
