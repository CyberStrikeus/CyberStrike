---
name: "T1213.005_messaging-applications"
description: "Adversaries may leverage chat and messaging applications, such as Microsoft Teams, Google Chat, and Slack, to mine valuable information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1213.005
  - collection
  - saas
  - office-suite
  - sub-technique
technique_id: "T1213.005"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - SaaS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1213/005"
tech_stack:
  - saas
  - office
cwe_ids:
  - CWE-200
chains_with:
  - T1213
  - T1213.001
  - T1213.002
  - T1213.003
  - T1213.004
  - T1213.006
prerequisites:
  - T1213
severity_boost:
  T1213: "Chain with T1213 for deeper attack path"
  T1213.001: "Chain with T1213.001 for deeper attack path"
  T1213.002: "Chain with T1213.002 for deeper attack path"
---

# T1213.005 Messaging Applications

> **Sub-technique of:** T1213

## High-Level Description

Adversaries may leverage chat and messaging applications, such as Microsoft Teams, Google Chat, and Slack, to mine valuable information.

The following is a brief list of example information that may hold potential value to an adversary and may also be found on messaging applications:

- Testing / development credentials (i.e., Chat Messages)
- Source code snippets
- Links to network shares and other internal resources
- Proprietary data
- Discussions about ongoing incident response efforts

In addition to exfiltrating data from messaging applications, adversaries may leverage data from chat messages in order to improve their targeting - for example, by learning more about an environment or evading ongoing incident response efforts.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** SaaS, Office Suite

## What to Check

- [ ] Identify if Messaging Applications technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Messaging Applications
- [ ] Check Office Suite systems for indicators of Messaging Applications
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Messaging Applications by examining the target platforms (SaaS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1213.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Develop and publish policies that define acceptable information to be posted in chat applications.

### M1047 Audit

Preemptively search through communication services to find inappropriately shared data, and take actions to reduce exposure when found.

### M1060 Out-of-Band Communications Channel

Implement secure out-of-band communication channels to use as an alternative to in-network chat applications during a security incident. This ensures that critical communications remain secure even if primary messaging channels are compromised by adversaries.

## Detection

### Detecting Unauthorized Collection from Messaging Applications in SaaS and Office Environments

## Risk Assessment

| Finding                                     | Severity | Impact     |
| ------------------------------------------- | -------- | ---------- |
| Messaging Applications technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Sentinel Labs NullBulge 2024](https://www.sentinelone.com/labs/nullbulge-threat-actor-masquerades-as-hacktivist-group-rebelling-against-ai/)
- [Permiso Scattered Spider 2023](https://permiso.io/blog/lucr-3-scattered-spider-getting-saas-y-in-the-cloud)
- [SC Magazine Ragnar Locker 2021](https://www.scmagazine.com/analysis/ragnar-locker-reminds-breach-victims-it-can-read-the-on-network-incident-response-chat-rooms)
- [Guardian Grand Theft Auto Leak 2022](https://www.theguardian.com/games/2022/sep/19/grand-theft-auto-6-leak-who-hacked-rockstar-and-what-was-stolen)
- [Microsoft DEV-0537](https://www.microsoft.com/security/blog/2022/03/22/dev-0537-criminal-actor-targeting-organizations-for-data-exfiltration-and-destruction/)
- [Atomic Red Team - T1213.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1213.005)
- [MITRE ATT&CK - T1213.005](https://attack.mitre.org/techniques/T1213/005)
