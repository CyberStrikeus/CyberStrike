---
name: "T1591.001_determine-physical-locations"
description: "Adversaries may gather the victim's physical location(s) that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1591.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1591.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1591/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1591
  - T1591.002
  - T1591.003
  - T1591.004
prerequisites:
  - T1591
severity_boost:
  T1591: "Chain with T1591 for deeper attack path"
  T1591.002: "Chain with T1591.002 for deeper attack path"
  T1591.003: "Chain with T1591.003 for deeper attack path"
---

# T1591.001 Determine Physical Locations

> **Sub-technique of:** T1591

## High-Level Description

Adversaries may gather the victim's physical location(s) that can be used during targeting. Information about physical locations of a target organization may include a variety of details, including where key resources and infrastructure are housed. Physical locations may also indicate what legal jurisdiction and/or authorities the victim operates within.

Adversaries may gather this information in various ways, such as direct elicitation via Phishing for Information. Physical locations of a target organization may also be exposed to adversaries via online or other accessible data sets (ex: Search Victim-Owned Websites or Social Media). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Websites/Domains), establishing operational resources (ex: Develop Capabilities or Obtain Capabilities), and/or initial access (ex: Phishing or Hardware Additions).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Determine Physical Locations technique is applicable to target environment
- [ ] Check PRE systems for indicators of Determine Physical Locations
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Determine Physical Locations by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1591.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Determine Physical Locations

## Risk Assessment

| Finding                                           | Severity | Impact         |
| ------------------------------------------------- | -------- | -------------- |
| Determine Physical Locations technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ThreatPost Broadvoice Leak](https://threatpost.com/broadvoice-leaks-350m-records-voicemail-transcripts/160158/)
- [SEC EDGAR Search](https://www.sec.gov/edgar/search/)
- [Atomic Red Team - T1591.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1591.001)
- [MITRE ATT&CK - T1591.001](https://attack.mitre.org/techniques/T1591/001)
