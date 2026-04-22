---
name: "T1036.010_masquerade-account-name"
description: "Adversaries may match or approximate the names of legitimate accounts to make newly created ones appear benign."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.010
  - defense-evasion
  - linux
  - macos
  - windows
  - saas
  - iaas
  - containers
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1036.010"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
  - SaaS
  - IaaS
  - Containers
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1036/010"
tech_stack:
  - linux
  - macos
  - windows
  - saas
  - cloud
  - containers
  - office
  - identity
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.003
  - T1036.004
  - T1036.005
  - T1036.006
  - T1036.007
  - T1036.008
  - T1036.009
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.010 Masquerade Account Name

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may match or approximate the names of legitimate accounts to make newly created ones appear benign. This will typically occur during Create Account, although accounts may also be renamed at a later date. This may also coincide with Account Access Removal if the actor first deletes an account before re-creating one with the same name.

Often, adversaries will attempt to masquerade as service accounts, such as those associated with legitimate software, data backups, or container cluster management. They may also give accounts generic, trustworthy names, such as “admin”, “help”, or “root.” Sometimes adversaries may model account names off of those already existing in the system, as a follow-on behavior to Account Discovery.

Note that this is distinct from Impersonation, which describes impersonating specific trusted individuals or organizations, rather than user or service account names.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows, SaaS, IaaS, Containers, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Masquerade Account Name technique is applicable to target environment
- [ ] Check Linux systems for indicators of Masquerade Account Name
- [ ] Check macOS systems for indicators of Masquerade Account Name
- [ ] Check Windows systems for indicators of Masquerade Account Name
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Masquerade Account Name by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Audit user accounts to ensure that each one has a defined purpose.

### M1018 User Account Management

Consider defining and enforcing a naming convention for user accounts to more easily spot generic account names that do not fit the typical schema.

## Detection

### Detection Strategy for Masquerading via Account Name Similarity

## Risk Assessment

| Finding                                      | Severity | Impact          |
| -------------------------------------------- | -------- | --------------- |
| Masquerade Account Name technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Elastic CUBA Ransomware 2022](https://www.elastic.co/security-labs/cuba-ransomware-campaign-analysis)
- [Invictus IR Cloud Ransomware 2024](https://www.invictus-ir.com/news/ransomware-in-the-cloud)
- [Huntress MOVEit 2023](https://www.huntress.com/blog/moveit-transfer-critical-vulnerability-rapid-response)
- [Aquasec Kubernetes Attack 2023](https://blog.aquasec.com/leveraging-kubernetes-rbac-to-backdoor-clusters)
- [Atomic Red Team - T1036.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.010)
- [MITRE ATT&CK - T1036.010](https://attack.mitre.org/techniques/T1036/010)
