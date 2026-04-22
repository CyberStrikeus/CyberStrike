---
name: "T1590.005_ip-addresses"
description: "Adversaries may gather the victim's IP addresses that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1590.005
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1590.005"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1590/005"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1590
  - T1590.001
  - T1590.002
  - T1590.003
  - T1590.004
  - T1590.006
prerequisites:
  - T1590
severity_boost:
  T1590: "Chain with T1590 for deeper attack path"
  T1590.001: "Chain with T1590.001 for deeper attack path"
  T1590.002: "Chain with T1590.002 for deeper attack path"
---

# T1590.005 IP Addresses

> **Sub-technique of:** T1590

## High-Level Description

Adversaries may gather the victim's IP addresses that can be used during targeting. Public IP addresses may be allocated to organizations by block, or a range of sequential addresses. Information about assigned IP addresses may include a variety of details, such as which IP addresses are in use. IP addresses may also enable an adversary to derive other details about a victim, such as organizational size, physical location(s), Internet service provider, and or where/how their publicly-facing infrastructure is hosted.

Adversaries may gather this information in various ways, such as direct collection actions via Active Scanning or Phishing for Information. Information about assigned IP addresses may also be exposed to adversaries via online or other accessible data sets (ex: Search Open Technical Databases). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Active Scanning or Search Open Websites/Domains), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: External Remote Services).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if IP Addresses technique is applicable to target environment
- [ ] Check PRE systems for indicators of IP Addresses
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to IP Addresses by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1590.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of IP Addresses


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| IP Addresses technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Circl Passive DNS](https://www.circl.lu/services/passive-dns/)
- [DNS Dumpster](https://dnsdumpster.com/)
- [WHOIS](https://who.is/)
- [Atomic Red Team - T1590.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1590.005)
- [MITRE ATT&CK - T1590.005](https://attack.mitre.org/techniques/T1590/005)
