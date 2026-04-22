---
name: "T1596.002_whois"
description: "Adversaries may search public WHOIS data for information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1596.002
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1596.002"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1596/002"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1596
  - T1596.001
  - T1596.003
  - T1596.004
  - T1596.005
prerequisites:
  - T1596
severity_boost:
  T1596: "Chain with T1596 for deeper attack path"
  T1596.001: "Chain with T1596.001 for deeper attack path"
  T1596.003: "Chain with T1596.003 for deeper attack path"
---

# T1596.002 WHOIS

> **Sub-technique of:** T1596

## High-Level Description

Adversaries may search public WHOIS data for information about victims that can be used during targeting. WHOIS data is stored by regional Internet registries (RIR) responsible for allocating and assigning Internet resources such as domain names. Anyone can query WHOIS servers for information about a registered domain, such as assigned IP blocks, contact information, and DNS nameservers.

Adversaries may search WHOIS data to gather actionable information. Threat actors can use online resources or command-line utilities to pillage through WHOIS data for information about potential victims. Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Active Scanning or Phishing for Information), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: External Remote Services or Trusted Relationship).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if WHOIS technique is applicable to target environment
- [ ] Check PRE systems for indicators of WHOIS
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to WHOIS by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1596.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of WHOIS

## Risk Assessment

| Finding                    | Severity | Impact         |
| -------------------------- | -------- | -------------- |
| WHOIS technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [WHOIS](https://who.is/)
- [Atomic Red Team - T1596.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1596.002)
- [MITRE ATT&CK - T1596.002](https://attack.mitre.org/techniques/T1596/002)
