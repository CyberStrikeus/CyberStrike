---
name: "T1562.007_disable-or-modify-cloud-firewall"
description: "Adversaries may disable or modify a firewall within a cloud environment to bypass controls that limit access to cloud resources."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.007
  - defense-evasion
  - iaas
  - sub-technique
technique_id: "T1562.007"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1562/007"
tech_stack:
  - cloud
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.001
  - T1562.002
  - T1562.003
  - T1562.004
  - T1562.006
  - T1562.008
  - T1562.009
  - T1562.010
  - T1562.011
  - T1562.012
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.007 Disable or Modify Cloud Firewall

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may disable or modify a firewall within a cloud environment to bypass controls that limit access to cloud resources. Cloud firewalls are separate from system firewalls that are described in Disable or Modify System Firewall. 

Cloud environments typically utilize restrictive security groups and firewall rules that only allow network activity from trusted IP addresses via expected ports and protocols. An adversary with appropriate permissions may introduce new firewall rules or policies to allow access into a victim cloud environment and/or move laterally from the cloud control plane to the data plane. For example, an adversary may use a script or utility that creates new ingress rules in existing security groups (or creates new security groups entirely) to allow any TCP/IP connectivity to a cloud-hosted instance. They may also remove networking limitations to support traffic associated with malicious activity (such as cryptomining).

Modifying or disabling a cloud firewall may enable adversary C2 communications, lateral movement, and/or data exfiltration that would otherwise not be allowed. It may also be used to open up resources for Brute Force or Endpoint Denial of Service.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Disable or Modify Cloud Firewall technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Disable or Modify Cloud Firewall
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disable or Modify Cloud Firewall by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit
Routinely check account role permissions to ensure only expected users and roles have permission to modify cloud firewalls.

### M1018 User Account Management
Ensure least privilege principles are applied to Identity and Access Management (IAM) security policies.


## Detection

### Detection Strategy for Disable or Modify Cloud Firewall


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Disable or Modify Cloud Firewall technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Expel IO Evil in AWS](https://expel.io/blog/finding-evil-in-aws/)
- [Palo Alto Unit 42 Compromised Cloud Compute Credentials 2022](https://unit42.paloaltonetworks.com/compromised-cloud-compute-credentials/)
- [Atomic Red Team - T1562.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.007)
- [MITRE ATT&CK - T1562.007](https://attack.mitre.org/techniques/T1562/007)
