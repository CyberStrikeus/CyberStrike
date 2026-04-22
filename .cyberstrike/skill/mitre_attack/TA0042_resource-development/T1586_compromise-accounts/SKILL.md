---
name: "T1586_compromise-accounts"
description: "Adversaries may compromise accounts with services that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1586
  - resource-development
  - pre
technique_id: "T1586"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1586"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1586.001
  - T1586.002
  - T1586.003
prerequisites:
  []
severity_boost:
  T1586.001: "Chain with T1586.001 for deeper attack path"
  T1586.002: "Chain with T1586.002 for deeper attack path"
  T1586.003: "Chain with T1586.003 for deeper attack path"
---

# T1586 Compromise Accounts

## High-Level Description

Adversaries may compromise accounts with services that can be used during targeting. For operations incorporating social engineering, the utilization of an online persona may be important. Rather than creating and cultivating accounts (i.e. Establish Accounts), adversaries may compromise existing accounts. Utilizing an existing persona may engender a level of trust in a potential victim if they have a relationship, or knowledge of, the compromised persona. 

A variety of methods exist for compromising accounts, such as gathering credentials via Phishing for Information, purchasing credentials from third-party sites, brute forcing credentials (ex: password reuse from breach credential dumps), or paying employees, suppliers or business partners for access to credentials. Prior to compromising accounts, adversaries may conduct Reconnaissance to inform decisions about which accounts to compromise to further their operation.

Personas may exist on a single site or across multiple sites (ex: Facebook, LinkedIn, Twitter, Google, etc.). Compromised accounts may require additional development, this could include filling out or modifying profile information, further developing social networks, or incorporating photos.

Adversaries may directly leverage compromised email accounts for Phishing for Information or Phishing.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Compromise Accounts technique is applicable to target environment
- [ ] Check PRE systems for indicators of Compromise Accounts
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compromise Accounts by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1586 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Compromise Accounts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compromise Accounts technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [AnonHBGary](https://arstechnica.com/tech-policy/2011/02/anonymous-speaks-the-inside-story-of-the-hbgary-hack/)
- [Microsoft DEV-0537](https://www.microsoft.com/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)
- [Atomic Red Team - T1586](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1586)
- [MITRE ATT&CK - T1586](https://attack.mitre.org/techniques/T1586)
