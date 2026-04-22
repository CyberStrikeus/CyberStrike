---
name: "T1596.001_dnspassive-dns"
description: "Adversaries may search DNS data for information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1596.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1596.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1596/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1596
  - T1596.002
  - T1596.003
  - T1596.004
  - T1596.005
prerequisites:
  - T1596
severity_boost:
  T1596: "Chain with T1596 for deeper attack path"
  T1596.002: "Chain with T1596.002 for deeper attack path"
  T1596.003: "Chain with T1596.003 for deeper attack path"
---

# T1596.001 DNS/Passive DNS

> **Sub-technique of:** T1596

## High-Level Description

Adversaries may search DNS data for information about victims that can be used during targeting. DNS information may include a variety of details, including registered name servers as well as records that outline addressing for a target’s subdomains, mail servers, and other hosts.

Adversaries may search DNS data to gather actionable information. Threat actors can query nameservers for a target organization directly, or search through centralized repositories of logged DNS query responses (known as passive DNS). Adversaries may also seek and target DNS misconfigurations/leaks that reveal information about internal networks. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Search Victim-Owned Websites or Search Open Websites/Domains), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: External Remote Services or Trusted Relationship).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if DNS/Passive DNS technique is applicable to target environment
- [ ] Check PRE systems for indicators of DNS/Passive DNS
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to DNS/Passive DNS by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1596.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.


## Detection

### Detection of DNS/Passive DNS


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| DNS/Passive DNS technique applicable | Low | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Circl Passive DNS](https://www.circl.lu/services/passive-dns/)
- [DNS Dumpster](https://dnsdumpster.com/)
- [Atomic Red Team - T1596.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1596.001)
- [MITRE ATT&CK - T1596.001](https://attack.mitre.org/techniques/T1596/001)
