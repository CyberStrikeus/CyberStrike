---
name: "T1591.003_identify-business-tempo"
description: "Adversaries may gather information about the victim's business tempo that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1591.003
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1591.003"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1591/003"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1591
  - T1591.001
  - T1591.002
  - T1591.004
prerequisites:
  - T1591
severity_boost:
  T1591: "Chain with T1591 for deeper attack path"
  T1591.001: "Chain with T1591.001 for deeper attack path"
  T1591.002: "Chain with T1591.002 for deeper attack path"
---

# T1591.003 Identify Business Tempo

> **Sub-technique of:** T1591

## High-Level Description

Adversaries may gather information about the victim's business tempo that can be used during targeting. Information about an organization’s business tempo may include a variety of details, including operational hours/days of the week. This information may also reveal times/dates of purchases and shipments of the victim’s hardware and software resources.

Adversaries may gather this information in various ways, such as direct elicitation via Phishing for Information. Information about business tempo may also be exposed to adversaries via online or other accessible data sets (ex: Social Media or Search Victim-Owned Websites). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Websites/Domains), establishing operational resources (ex: Establish Accounts or Compromise Accounts), and/or initial access (ex: Supply Chain Compromise or Trusted Relationship)

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Identify Business Tempo technique is applicable to target environment
- [ ] Check PRE systems for indicators of Identify Business Tempo
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Identify Business Tempo by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1591.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Identify Business Tempo

## Risk Assessment

| Finding                                      | Severity | Impact         |
| -------------------------------------------- | -------- | -------------- |
| Identify Business Tempo technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ThreatPost Broadvoice Leak](https://threatpost.com/broadvoice-leaks-350m-records-voicemail-transcripts/160158/)
- [Atomic Red Team - T1591.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1591.003)
- [MITRE ATT&CK - T1591.003](https://attack.mitre.org/techniques/T1591/003)
