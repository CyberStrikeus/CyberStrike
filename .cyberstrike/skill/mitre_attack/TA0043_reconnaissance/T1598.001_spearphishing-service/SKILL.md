---
name: "T1598.001_spearphishing-service"
description: "Adversaries may send spearphishing messages via third-party services to elicit sensitive information that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1598.001
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1598.001"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1598/001"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1598
  - T1598.002
  - T1598.003
  - T1598.004
prerequisites:
  - T1598
severity_boost:
  T1598: "Chain with T1598 for deeper attack path"
  T1598.002: "Chain with T1598.002 for deeper attack path"
  T1598.003: "Chain with T1598.003 for deeper attack path"
---

# T1598.001 Spearphishing Service

> **Sub-technique of:** T1598

## High-Level Description

Adversaries may send spearphishing messages via third-party services to elicit sensitive information that can be used during targeting. Spearphishing for information is an attempt to trick targets into divulging information, frequently credentials or other actionable information. Spearphishing for information frequently involves social engineering techniques, such as posing as a source with a reason to collect information (ex: Establish Accounts or Compromise Accounts) and/or sending multiple, seemingly urgent messages.

All forms of spearphishing are electronically delivered social engineering targeted at a specific individual, company, or industry. In this scenario, adversaries send messages through various social media services, personal webmail, and other non-enterprise controlled services. These services are more likely to have a less-strict security policy than an enterprise. As with most kinds of spearphishing, the goal is to generate rapport with the target or get the target's interest in some way. Adversaries may create fake social media accounts and message employees for potential job opportunities. Doing so allows a plausible reason for asking about services, policies, and information about their environment. Adversaries may also use information from previous reconnaissance efforts (ex: Social Media or Search Victim-Owned Websites) to craft persuasive and believable lures.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Spearphishing Service technique is applicable to target environment
- [ ] Check PRE systems for indicators of Spearphishing Service
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spearphishing Service by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1598.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training
Users can be trained to identify social engineering techniques and spearphishing attempts.


## Detection

### Detection of Spearphishing Service


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Spearphishing Service technique applicable | High | Reconnaissance |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [ThreatPost Social Media Phishing](https://threatpost.com/facebook-launching-pad-phishing-attacks/160351/)
- [Atomic Red Team - T1598.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1598.001)
- [MITRE ATT&CK - T1598.001](https://attack.mitre.org/techniques/T1598/001)
