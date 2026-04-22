---
name: "T1578.001_create-snapshot"
description: "An adversary may create a snapshot or data backup within a cloud account to evade defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1578.001
  - defense-evasion
  - iaas
  - sub-technique
technique_id: "T1578.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1578/001"
tech_stack:
  - cloud
cwe_ids:
  - CWE-693
chains_with:
  - T1578
  - T1578.002
  - T1578.003
  - T1578.004
  - T1578.005
prerequisites:
  - T1578
severity_boost:
  T1578: "Chain with T1578 for deeper attack path"
  T1578.002: "Chain with T1578.002 for deeper attack path"
  T1578.003: "Chain with T1578.003 for deeper attack path"
---

# T1578.001 Create Snapshot

> **Sub-technique of:** T1578

## High-Level Description

An adversary may create a snapshot or data backup within a cloud account to evade defenses. A snapshot is a point-in-time copy of an existing cloud compute component such as a virtual machine (VM), virtual hard drive, or volume. An adversary may leverage permissions to create a snapshot in order to bypass restrictions that prevent access to existing compute service infrastructure, unlike in Revert Cloud Instance where an adversary may revert to a snapshot to evade detection and remove evidence of their presence.

An adversary may Create Cloud Instance, mount one or more created snapshots to that instance, and then apply a policy that allows the adversary access to the created instance, such as a firewall policy that allows them inbound and outbound SSH access.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Create Snapshot technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Create Snapshot
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Create Snapshot by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1578.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Routinely check user permissions to ensure only the expected users have the capability to create snapshots and backups.

### M1018 User Account Management

Limit permissions for creating snapshots or backups in accordance with least privilege. Organizations should limit the number of users within the organization with an IAM role that has administrative privileges, strive to reduce all permanent privileged role assignments, and conduct periodic entitlement reviews on IAM users, roles and policies.

## Detection

### Detection Strategy for Modify Cloud Compute Infrastructure: Create Snapshot

## Risk Assessment

| Finding                              | Severity | Impact          |
| ------------------------------------ | -------- | --------------- |
| Create Snapshot technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [AWS Cloud Trail Backup API](https://docs.aws.amazon.com/aws-backup/latest/devguide/logging-using-cloudtrail.html)
- [GCP - Creating and Starting a VM](https://cloud.google.com/compute/docs/instances/create-start-instance#api_2)
- [Cloud Audit Logs](https://cloud.google.com/logging/docs/audit#admin-activity)
- [Mandiant M-Trends 2020](https://www.mandiant.com/sites/default/files/2021-09/mtrends-2020.pdf)
- [Azure - Monitor Logs](https://docs.microsoft.com/en-us/azure/backup/backup-azure-monitoring-use-azuremonitor)
- [Atomic Red Team - T1578.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1578.001)
- [MITRE ATT&CK - T1578.001](https://attack.mitre.org/techniques/T1578/001)
