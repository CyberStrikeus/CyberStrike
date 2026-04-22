---
name: "T1578.005_modify-cloud-compute-configurations"
description: "Adversaries may modify settings that directly affect the size, locations, and resources available to cloud compute infrastructure in order to evade defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1578.005
  - defense-evasion
  - iaas
  - sub-technique
technique_id: "T1578.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1578/005"
tech_stack:
  - cloud
cwe_ids:
  - CWE-693
chains_with:
  - T1578
  - T1578.001
  - T1578.002
  - T1578.003
  - T1578.004
prerequisites:
  - T1578
severity_boost:
  T1578: "Chain with T1578 for deeper attack path"
  T1578.001: "Chain with T1578.001 for deeper attack path"
  T1578.002: "Chain with T1578.002 for deeper attack path"
---

# T1578.005 Modify Cloud Compute Configurations

> **Sub-technique of:** T1578

## High-Level Description

Adversaries may modify settings that directly affect the size, locations, and resources available to cloud compute infrastructure in order to evade defenses. These settings may include service quotas, subscription associations, tenant-wide policies, or other configurations that impact available compute. Such modifications may allow adversaries to abuse the victim’s compute resources to achieve their goals, potentially without affecting the execution of running instances and/or revealing their activities to the victim.

For example, cloud providers often limit customer usage of compute resources via quotas. Customers may request adjustments to these quotas to support increased computing needs, though these adjustments may require approval from the cloud provider. Adversaries who compromise a cloud environment may similarly request quota adjustments in order to support their activities, such as enabling additional Resource Hijacking without raising suspicion by using up a victim’s entire quota. Adversaries may also increase allowed resource usage by modifying any tenant-wide policies that limit the sizes of deployed virtual machines.

Adversaries may also modify settings that affect where cloud resources can be deployed, such as enabling Unused/Unsupported Cloud Regions.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Modify Cloud Compute Configurations technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Modify Cloud Compute Configurations
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Modify Cloud Compute Configurations by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1578.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management
Limit permissions to request quotas adjustments or modify tenant-level compute setting to only those required.

### M1047 Audit
Routinely monitor user permissions to ensure only the expected users have the capability to request quota adjustments or modify tenant-level compute settings.


## Detection

### Detection Strategy for Modify Cloud Compute Infrastructure: Modify Cloud Compute Configurations


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Modify Cloud Compute Configurations technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Microsoft Cryptojacking 2023](https://www.microsoft.com/en-us/security/blog/2023/07/25/cryptojacking-understanding-and-defending-against-cloud-compute-resource-abuse/)
- [Microsoft Azure Policy](https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies#compute)
- [Atomic Red Team - T1578.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1578.005)
- [MITRE ATT&CK - T1578.005](https://attack.mitre.org/techniques/T1578/005)
