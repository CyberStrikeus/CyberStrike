---
name: "T1595_active-scanning"
description: "Adversaries may execute active reconnaissance scans to gather information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1595
  - reconnaissance
  - pre
technique_id: "T1595"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1595"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1595.001
  - T1595.002
  - T1595.003
prerequisites: []
severity_boost:
  T1595.001: "Chain with T1595.001 for deeper attack path"
  T1595.002: "Chain with T1595.002 for deeper attack path"
  T1595.003: "Chain with T1595.003 for deeper attack path"
---

# T1595 Active Scanning

## High-Level Description

Adversaries may execute active reconnaissance scans to gather information that can be used during targeting. Active scans are those where the adversary probes victim infrastructure via network traffic, as opposed to other forms of reconnaissance that do not involve direct interaction.

Adversaries may perform different forms of active scanning depending on what information they seek to gather. These scans can also be performed in various ways, including using native features of network protocols such as ICMP. Information from these scans may reveal opportunities for other forms of reconnaissance (ex: Search Open Websites/Domains or Search Open Technical Databases), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: External Remote Services or Exploit Public-Facing Application).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Active Scanning technique is applicable to target environment
- [ ] Check PRE systems for indicators of Active Scanning
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Active Scanning by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1595 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Active Scanning

## Risk Assessment

| Finding                              | Severity | Impact         |
| ------------------------------------ | -------- | -------------- |
| Active Scanning technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Botnet Scan](https://www.caida.org/publications/papers/2012/analysis_slash_zero/analysis_slash_zero.pdf)
- [OWASP Fingerprinting](https://wiki.owasp.org/index.php/OAT-004_Fingerprinting)
- [Atomic Red Team - T1595](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1595)
- [MITRE ATT&CK - T1595](https://attack.mitre.org/techniques/T1595)
