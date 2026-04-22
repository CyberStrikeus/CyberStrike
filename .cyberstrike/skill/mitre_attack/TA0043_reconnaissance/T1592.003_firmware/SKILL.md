---
name: "T1592.003_firmware"
description: "Adversaries may gather information about the victim's host firmware that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1592.003
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1592.003"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1592/003"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1592
  - T1592.001
  - T1592.002
  - T1592.004
prerequisites:
  - T1592
severity_boost:
  T1592: "Chain with T1592 for deeper attack path"
  T1592.001: "Chain with T1592.001 for deeper attack path"
  T1592.002: "Chain with T1592.002 for deeper attack path"
---

# T1592.003 Firmware

> **Sub-technique of:** T1592

## High-Level Description

Adversaries may gather information about the victim's host firmware that can be used during targeting. Information about host firmware may include a variety of details such as type and versions on specific hosts, which may be used to infer more information about hosts in the environment (ex: configuration, purpose, age/patch level, etc.).

Adversaries may gather this information in various ways, such as direct elicitation via Phishing for Information. Information about host firmware may only be exposed to adversaries via online or other accessible data sets (ex: job postings, network maps, assessment reports, resumes, or purchase invoices). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Websites/Domains or Search Open Technical Databases), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: Supply Chain Compromise or Exploit Public-Facing Application).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Firmware technique is applicable to target environment
- [ ] Check PRE systems for indicators of Firmware
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Firmware by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1592.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Firmware

## Risk Assessment

| Finding                       | Severity | Impact         |
| ----------------------------- | -------- | -------------- |
| Firmware technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ArsTechnica Intel](https://arstechnica.com/information-technology/2020/08/intel-is-investigating-the-leak-of-20gb-of-its-source-code-and-private-data/)
- [Atomic Red Team - T1592.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1592.003)
- [MITRE ATT&CK - T1592.003](https://attack.mitre.org/techniques/T1592/003)
