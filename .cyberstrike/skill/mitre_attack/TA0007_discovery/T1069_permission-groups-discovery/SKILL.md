---
name: "T1069_permission-groups-discovery"
description: "Adversaries may attempt to discover group and permission settings."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1069
  - discovery
  - containers
  - iaas
  - identity-provider
  - linux
  - macos
  - office-suite
  - saas
  - windows
technique_id: "T1069"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Containers
  - IaaS
  - Identity Provider
  - Linux
  - macOS
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1069"
tech_stack:
  - containers
  - cloud
  - identity
  - linux
  - macos
  - office
  - saas
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1069.001
  - T1069.002
  - T1069.003
prerequisites:
  []
severity_boost:
  T1069.001: "Chain with T1069.001 for deeper attack path"
  T1069.002: "Chain with T1069.002 for deeper attack path"
  T1069.003: "Chain with T1069.003 for deeper attack path"
---

# T1069 Permission Groups Discovery

## High-Level Description

Adversaries may attempt to discover group and permission settings. This information can help adversaries determine which user accounts and groups are available, the membership of users in particular groups, and which users and groups have elevated permissions.

Adversaries may attempt to discover group permission settings in many different ways. This data may provide the adversary with information about the compromised environment that can be used in follow-on activity and targeting.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Containers, IaaS, Identity Provider, Linux, macOS, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Permission Groups Discovery technique is applicable to target environment
- [ ] Check Containers systems for indicators of Permission Groups Discovery
- [ ] Check IaaS systems for indicators of Permission Groups Discovery
- [ ] Check Identity Provider systems for indicators of Permission Groups Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Permission Groups Discovery by examining the target platforms (Containers, IaaS, Identity Provider).

2. **Assess Existing Defenses**: Review whether mitigations for T1069 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavioral Detection of Permission Groups Discovery


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Permission Groups Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [K8s Authorization Overview](https://kubernetes.io/docs/reference/access-authn-authz/authorization/)
- [CrowdStrike BloodHound April 2018](https://www.crowdstrike.com/blog/hidden-administrative-accounts-bloodhound-to-the-rescue/)
- [Atomic Red Team - T1069](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1069)
- [MITRE ATT&CK - T1069](https://attack.mitre.org/techniques/T1069)
