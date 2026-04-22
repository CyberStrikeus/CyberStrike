---
name: "T1578_modify-cloud-compute-infrastructure"
description: "An adversary may attempt to modify a cloud account's compute service infrastructure to evade defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1578
  - defense-evasion
  - iaas
technique_id: "T1578"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1578"
tech_stack:
  - cloud
cwe_ids:
  - CWE-693
chains_with:
  - T1578.001
  - T1578.002
  - T1578.003
  - T1578.004
  - T1578.005
prerequisites:
  []
severity_boost:
  T1578.001: "Chain with T1578.001 for deeper attack path"
  T1578.002: "Chain with T1578.002 for deeper attack path"
  T1578.003: "Chain with T1578.003 for deeper attack path"
---

# T1578 Modify Cloud Compute Infrastructure

## High-Level Description

An adversary may attempt to modify a cloud account's compute service infrastructure to evade defenses. A modification to the compute service infrastructure can include the creation, deletion, or modification of one or more components such as compute instances, virtual machines, and snapshots.

Permissions gained from the modification of infrastructure components may bypass restrictions that prevent access to existing infrastructure. Modifying infrastructure components may also allow an adversary to evade detection and remove evidence of their presence.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Modify Cloud Compute Infrastructure technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Modify Cloud Compute Infrastructure
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Modify Cloud Compute Infrastructure by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1578 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management
Limit permissions for creating, deleting, and otherwise altering compute components in accordance with least privilege. Organizations should limit the number of users within the organization with an IAM role that has administrative privileges, strive to reduce all permanent privileged role assignments, and conduct periodic entitlement reviews on IAM users, roles and policies.

### M1047 Audit
Routinely monitor user permissions to ensure only the expected users have the capability to modify cloud compute infrastructure components.


## Detection

### Detection Strategy for Modify Cloud Compute Infrastructure


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Modify Cloud Compute Infrastructure technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Mandiant M-Trends 2020](https://www.mandiant.com/sites/default/files/2021-09/mtrends-2020.pdf)
- [Atomic Red Team - T1578](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1578)
- [MITRE ATT&CK - T1578](https://attack.mitre.org/techniques/T1578)
