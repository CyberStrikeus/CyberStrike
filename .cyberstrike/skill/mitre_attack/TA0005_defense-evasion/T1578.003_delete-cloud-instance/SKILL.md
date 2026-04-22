---
name: "T1578.003_delete-cloud-instance"
description: "An adversary may delete a cloud instance after they have performed malicious activities in an attempt to evade detection and remove evidence of their presence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1578.003
  - defense-evasion
  - iaas
  - sub-technique
technique_id: "T1578.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1578/003"
tech_stack:
  - cloud
cwe_ids:
  - CWE-693
chains_with:
  - T1578
  - T1578.001
  - T1578.002
  - T1578.004
  - T1578.005
prerequisites:
  - T1578
severity_boost:
  T1578: "Chain with T1578 for deeper attack path"
  T1578.001: "Chain with T1578.001 for deeper attack path"
  T1578.002: "Chain with T1578.002 for deeper attack path"
---

# T1578.003 Delete Cloud Instance

> **Sub-technique of:** T1578

## High-Level Description

An adversary may delete a cloud instance after they have performed malicious activities in an attempt to evade detection and remove evidence of their presence. Deleting an instance or virtual machine can remove valuable forensic artifacts and other evidence of suspicious behavior if the instance is not recoverable.

An adversary may also Create Cloud Instance and later terminate the instance after achieving their objectives.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Delete Cloud Instance technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Delete Cloud Instance
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Delete Cloud Instance by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1578.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Limit permissions for deleting new instances in accordance with least privilege. Organizations should limit the number of users within the organization with an IAM role that has administrative privileges, strive to reduce all permanent privileged role assignments, and conduct periodic entitlement reviews on IAM users, roles and policies.

### M1047 Audit

Routinely check user permissions to ensure only the expected users have the capability to delete new instances.

## Detection

### Detection Strategy for Modify Cloud Compute Infrastructure: Delete Cloud Instance

## Risk Assessment

| Finding                                    | Severity | Impact          |
| ------------------------------------------ | -------- | --------------- |
| Delete Cloud Instance technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [AWS CloudTrail Search](https://aws.amazon.com/premiumsupport/knowledge-center/cloudtrail-search-api-calls/)
- [Cloud Audit Logs](https://cloud.google.com/logging/docs/audit#admin-activity)
- [Mandiant M-Trends 2020](https://www.mandiant.com/sites/default/files/2021-09/mtrends-2020.pdf)
- [Azure Activity Logs](https://docs.microsoft.com/en-us/azure/azure-resource-manager/management/view-activity-logs)
- [Atomic Red Team - T1578.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1578.003)
- [MITRE ATT&CK - T1578.003](https://attack.mitre.org/techniques/T1578/003)
