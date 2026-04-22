---
name: "T1585.001_social-media-accounts"
description: "Adversaries may create and cultivate social media accounts that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1585.001
  - resource-development
  - pre
  - sub-technique
technique_id: "T1585.001"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1585/001"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1585
  - T1585.002
  - T1585.003
prerequisites:
  - T1585
severity_boost:
  T1585: "Chain with T1585 for deeper attack path"
  T1585.002: "Chain with T1585.002 for deeper attack path"
  T1585.003: "Chain with T1585.003 for deeper attack path"
---

# T1585.001 Social Media Accounts

> **Sub-technique of:** T1585

## High-Level Description

Adversaries may create and cultivate social media accounts that can be used during targeting. Adversaries can create social media accounts that can be used to build a persona to further operations. Persona development consists of the development of public information, presence, history and appropriate affiliations.

For operations incorporating social engineering, the utilization of a persona on social media may be important. These personas may be fictitious or impersonate real people. The persona may exist on a single social media site or across multiple sites (ex: Facebook, LinkedIn, Twitter, etc.). Establishing a persona on social media may require development of additional documentation to make them seem real. This could include filling out profile information, developing social networks, or incorporating photos.

Once a persona has been developed an adversary can use it to create connections to targets of interest. These connections may be direct or may include trying to connect through others. These accounts may be leveraged during other phases of the adversary lifecycle, such as during Initial Access (ex: Spearphishing via Service).

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

2. **Assess Existing Defenses**: Review whether mitigations for T1585.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Social Media Accounts

## Risk Assessment

| Finding                                    | Severity | Impact               |
| ------------------------------------------ | -------- | -------------------- |
| Social Media Accounts technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [NEWSCASTER2014](https://www.securityweek.com/iranian-hackers-targeted-us-officials-elaborate-social-media-attack-operation)
- [BlackHatRobinSage](http://media.blackhat.com/bh-us-10/whitepapers/Ryan/BlackHat-USA-2010-Ryan-Getting-In-Bed-With-Robin-Sage-v1.0.pdf)
- [Atomic Red Team - T1585.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1585.001)
- [MITRE ATT&CK - T1585.001](https://attack.mitre.org/techniques/T1585/001)
