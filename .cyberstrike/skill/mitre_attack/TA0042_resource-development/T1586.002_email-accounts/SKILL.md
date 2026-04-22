---
name: "T1586.002_email-accounts"
description: "Adversaries may compromise email accounts that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1586.002
  - resource-development
  - pre
  - sub-technique
technique_id: "T1586.002"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1586/002"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1586
  - T1586.001
  - T1586.003
prerequisites:
  - T1586
severity_boost:
  T1586: "Chain with T1586 for deeper attack path"
  T1586.001: "Chain with T1586.001 for deeper attack path"
  T1586.003: "Chain with T1586.003 for deeper attack path"
---

# T1586.002 Email Accounts

> **Sub-technique of:** T1586

## High-Level Description

Adversaries may compromise email accounts that can be used during targeting. Adversaries can use compromised email accounts to further their operations, such as leveraging them to conduct Phishing for Information, Phishing, or large-scale spam email campaigns. Utilizing an existing persona with a compromised email account may engender a level of trust in a potential victim if they have a relationship with, or knowledge of, the compromised persona. Compromised email accounts can also be used in the acquisition of infrastructure (ex: Domains).

A variety of methods exist for compromising email accounts, such as gathering credentials via Phishing for Information, purchasing credentials from third-party sites, brute forcing credentials (ex: password reuse from breach credential dumps), or paying employees, suppliers or business partners for access to credentials. Prior to compromising email accounts, adversaries may conduct Reconnaissance to inform decisions about which accounts to compromise to further their operation. Adversaries may target compromising well-known email accounts or domains from which malicious spam or Phishing emails may evade reputation-based email filtering rules.

Adversaries can use a compromised email account to hijack existing email threads with targets of interest.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Email Accounts technique is applicable to target environment
- [ ] Check PRE systems for indicators of Email Accounts
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Email Accounts by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1586.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Email Accounts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Email Accounts technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [AnonHBGary](https://arstechnica.com/tech-policy/2011/02/anonymous-speaks-the-inside-story-of-the-hbgary-hack/)
- [Microsoft DEV-0537](https://www.microsoft.com/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)
- [Atomic Red Team - T1586.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1586.002)
- [MITRE ATT&CK - T1586.002](https://attack.mitre.org/techniques/T1586/002)
