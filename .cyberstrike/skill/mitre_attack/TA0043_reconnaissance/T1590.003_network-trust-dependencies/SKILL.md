---
name: "T1590.003_network-trust-dependencies"
description: "Adversaries may gather information about the victim's network trust dependencies that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1590.003
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1590.003"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1590/003"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1590
  - T1590.001
  - T1590.002
  - T1590.004
  - T1590.005
  - T1590.006
prerequisites:
  - T1590
severity_boost:
  T1590: "Chain with T1590 for deeper attack path"
  T1590.001: "Chain with T1590.001 for deeper attack path"
  T1590.002: "Chain with T1590.002 for deeper attack path"
---

# T1590.003 Network Trust Dependencies

> **Sub-technique of:** T1590

## High-Level Description

Adversaries may gather information about the victim's network trust dependencies that can be used during targeting. Information about network trusts may include a variety of details, including second or third-party organizations/domains (ex: managed service providers, contractors, etc.) that have connected (and potentially elevated) network access.

Adversaries may gather this information in various ways, such as direct elicitation via Phishing for Information. Information about network trusts may also be exposed to adversaries via online or other accessible data sets (ex: Search Open Technical Databases). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Active Scanning or Search Open Websites/Domains), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: Trusted Relationship).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Network Trust Dependencies technique is applicable to target environment
- [ ] Check PRE systems for indicators of Network Trust Dependencies
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Trust Dependencies by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1590.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Network Trust Dependencies

## Risk Assessment

| Finding                                         | Severity | Impact         |
| ----------------------------------------------- | -------- | -------------- |
| Network Trust Dependencies technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Pentesting AD Forests](https://www.slideshare.net/rootedcon/carlos-garca-pentesting-active-directory-forests-rooted2019)
- [Atomic Red Team - T1590.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1590.003)
- [MITRE ATT&CK - T1590.003](https://attack.mitre.org/techniques/T1590/003)
