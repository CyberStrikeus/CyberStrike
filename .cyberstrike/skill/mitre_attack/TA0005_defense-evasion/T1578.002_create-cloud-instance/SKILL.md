---
name: "T1578.002_create-cloud-instance"
description: "An adversary may create a new instance or virtual machine (VM) within the compute service of a cloud account to evade defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1578.002
  - defense-evasion
  - iaas
  - sub-technique
technique_id: "T1578.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1578/002"
tech_stack:
  - cloud
cwe_ids:
  - CWE-693
chains_with:
  - T1578
  - T1578.001
  - T1578.003
  - T1578.004
  - T1578.005
prerequisites:
  - T1578
severity_boost:
  T1578: "Chain with T1578 for deeper attack path"
  T1578.001: "Chain with T1578.001 for deeper attack path"
  T1578.003: "Chain with T1578.003 for deeper attack path"
---

# T1578.002 Create Cloud Instance

> **Sub-technique of:** T1578

## High-Level Description

An adversary may create a new instance or virtual machine (VM) within the compute service of a cloud account to evade defenses. Creating a new instance may allow an adversary to bypass firewall rules and permissions that exist on instances currently residing within an account. An adversary may Create Snapshot of one or more volumes in an account, create a new instance, mount the snapshots, and then apply a less restrictive security policy to collect Data from Local System or for Remote Data Staging.

Creating a new instance may also allow an adversary to carry out malicious activity within an environment without affecting the execution of current running instances.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Create Cloud Instance technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Create Cloud Instance
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Create Cloud Instance by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1578.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit
Routinely check user permissions to ensure only the expected users have the capability to create new instances.

### M1018 User Account Management
Limit permissions for creating new instances in accordance with least privilege. Organizations should limit the number of users within the organization with an IAM role that has administrative privileges, strive to reduce all permanent privileged role assignments, and conduct periodic entitlement reviews on IAM users, roles and policies.


## Detection

### Detection Strategy for Modify Cloud Compute Infrastructure: Create Cloud Instance


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Create Cloud Instance technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [AWS CloudTrail Search](https://aws.amazon.com/premiumsupport/knowledge-center/cloudtrail-search-api-calls/)
- [Cloud Audit Logs](https://cloud.google.com/logging/docs/audit#admin-activity)
- [Mandiant M-Trends 2020](https://www.mandiant.com/sites/default/files/2021-09/mtrends-2020.pdf)
- [Azure Activity Logs](https://docs.microsoft.com/en-us/azure/azure-resource-manager/management/view-activity-logs)
- [Atomic Red Team - T1578.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1578.002)
- [MITRE ATT&CK - T1578.002](https://attack.mitre.org/techniques/T1578/002)
