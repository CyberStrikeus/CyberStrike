---
name: "T1585_establish-accounts"
description: "Adversaries may create and cultivate accounts with services that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1585
  - resource-development
  - pre
technique_id: "T1585"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1585"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1585.001
  - T1585.002
  - T1585.003
prerequisites:
  []
severity_boost:
  T1585.001: "Chain with T1585.001 for deeper attack path"
  T1585.002: "Chain with T1585.002 for deeper attack path"
  T1585.003: "Chain with T1585.003 for deeper attack path"
---

# T1585 Establish Accounts

## High-Level Description

Adversaries may create and cultivate accounts with services that can be used during targeting. Adversaries can create accounts that can be used to build a persona to further operations. Persona development consists of the development of public information, presence, history and appropriate affiliations. This development could be applied to social media, website, or other publicly available information that could be referenced and scrutinized for legitimacy over the course of an operation using that persona or identity.

For operations incorporating social engineering, the utilization of an online persona may be important. These personas may be fictitious or impersonate real people. The persona may exist on a single site or across multiple sites (ex: Facebook, LinkedIn, Twitter, Google, GitHub, Docker Hub, etc.). Establishing a persona may require development of additional documentation to make them seem real. This could include filling out profile information, developing social networks, or incorporating photos.

Establishing accounts can also include the creation of accounts with email providers, which may be directly leveraged for Phishing for Information or Phishing. In addition, establishing accounts may allow adversaries to abuse free services, such as registering for trial periods to Acquire Infrastructure for malicious purposes.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Establish Accounts technique is applicable to target environment
- [ ] Check PRE systems for indicators of Establish Accounts
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Establish Accounts by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1585 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Establish Accounts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Establish Accounts technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Free Trial PurpleUrchin](https://unit42.paloaltonetworks.com/purpleurchin-steals-cloud-resources/)
- [NEWSCASTER2014](https://www.securityweek.com/iranian-hackers-targeted-us-officials-elaborate-social-media-attack-operation)
- [Mandiant APT1](https://www.fireeye.com/content/dam/fireeye-www/services/pdfs/mandiant-apt1-report.pdf)
- [BlackHatRobinSage](http://media.blackhat.com/bh-us-10/whitepapers/Ryan/BlackHat-USA-2010-Ryan-Getting-In-Bed-With-Robin-Sage-v1.0.pdf)
- [Atomic Red Team - T1585](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1585)
- [MITRE ATT&CK - T1585](https://attack.mitre.org/techniques/T1585)
