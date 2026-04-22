---
name: "T1593.001_social-media"
description: "Adversaries may search social media for information about victims that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1593.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1593.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1593/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1593
  - T1593.002
  - T1593.003
prerequisites:
  - T1593
severity_boost:
  T1593: "Chain with T1593 for deeper attack path"
  T1593.002: "Chain with T1593.002 for deeper attack path"
  T1593.003: "Chain with T1593.003 for deeper attack path"
---

# T1593.001 Social Media

> **Sub-technique of:** T1593

## High-Level Description

Adversaries may search social media for information about victims that can be used during targeting. Social media sites may contain various information about a victim organization, such as business announcements as well as information about the roles, locations, and interests of staff.

Adversaries may search in different social media sites depending on what information they seek to gather. Threat actors may passively harvest data from these sites, as well as use information gathered to create fake profiles/groups to elicit victim’s into revealing specific information (i.e. Spearphishing Service). Information from these sources may reveal opportunities for other forms of reconnaissance (ex: Phishing for Information or Search Open Technical Databases), establishing operational resources (ex: Establish Accounts or Compromise Accounts), and/or initial access (ex: Spearphishing via Service).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Social Media technique is applicable to target environment
- [ ] Check PRE systems for indicators of Social Media
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Social Media by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1593.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Social Media

## Risk Assessment

| Finding                           | Severity | Impact         |
| --------------------------------- | -------- | -------------- |
| Social Media technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Cyware Social Media](https://cyware.com/news/how-hackers-exploit-social-media-to-break-into-your-company-88e8da8e)
- [Atomic Red Team - T1593.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1593.001)
- [MITRE ATT&CK - T1593.001](https://attack.mitre.org/techniques/T1593/001)
