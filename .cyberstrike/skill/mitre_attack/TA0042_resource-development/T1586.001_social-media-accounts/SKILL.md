---
name: "T1586.001_social-media-accounts"
description: "Adversaries may compromise social media accounts that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1586.001
  - resource-development
  - pre
  - sub-technique
technique_id: "T1586.001"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1586/001"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1586
  - T1586.002
  - T1586.003
prerequisites:
  - T1586
severity_boost:
  T1586: "Chain with T1586 for deeper attack path"
  T1586.002: "Chain with T1586.002 for deeper attack path"
  T1586.003: "Chain with T1586.003 for deeper attack path"
---

# T1586.001 Social Media Accounts

> **Sub-technique of:** T1586

## High-Level Description

Adversaries may compromise social media accounts that can be used during targeting. For operations incorporating social engineering, the utilization of an online persona may be important. Rather than creating and cultivating social media profiles (i.e. Social Media Accounts), adversaries may compromise existing social media accounts. Utilizing an existing persona may engender a level of trust in a potential victim if they have a relationship, or knowledge of, the compromised persona. 

A variety of methods exist for compromising social media accounts, such as gathering credentials via Phishing for Information, purchasing credentials from third-party sites, or by brute forcing credentials (ex: password reuse from breach credential dumps). Prior to compromising social media accounts, adversaries may conduct Reconnaissance to inform decisions about which accounts to compromise to further their operation.

Personas may exist on a single site or across multiple sites (ex: Facebook, LinkedIn, Twitter, etc.). Compromised social media accounts may require additional development, this could include filling out or modifying profile information, further developing social networks, or incorporating photos.

Adversaries can use a compromised social media profile to create new, or hijack existing, connections to targets of interest. These connections may be direct or may include trying to connect through others. Compromised profiles may be leveraged during other phases of the adversary lifecycle, such as during Initial Access (ex: Spearphishing via Service).

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Social Media Accounts technique is applicable to target environment
- [ ] Check PRE systems for indicators of Social Media Accounts
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Social Media Accounts by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1586.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Social Media Accounts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Social Media Accounts technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [AnonHBGary](https://arstechnica.com/tech-policy/2011/02/anonymous-speaks-the-inside-story-of-the-hbgary-hack/)
- [NEWSCASTER2014](https://www.securityweek.com/iranian-hackers-targeted-us-officials-elaborate-social-media-attack-operation)
- [BlackHatRobinSage](http://media.blackhat.com/bh-us-10/whitepapers/Ryan/BlackHat-USA-2010-Ryan-Getting-In-Bed-With-Robin-Sage-v1.0.pdf)
- [Atomic Red Team - T1586.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1586.001)
- [MITRE ATT&CK - T1586.001](https://attack.mitre.org/techniques/T1586/001)
