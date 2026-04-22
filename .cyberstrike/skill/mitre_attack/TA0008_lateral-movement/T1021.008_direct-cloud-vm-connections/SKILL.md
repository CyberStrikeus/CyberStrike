---
name: "T1021.008_direct-cloud-vm-connections"
description: "Adversaries may leverage Valid Accounts to log directly into accessible cloud hosted compute infrastructure through cloud native methods."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021.008
  - lateral-movement
  - iaas
  - sub-technique
technique_id: "T1021.008"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1021/008"
tech_stack:
  - cloud
cwe_ids:
  - CWE-284
chains_with:
  - T1021
  - T1021.001
  - T1021.002
  - T1021.003
  - T1021.004
  - T1021.005
  - T1021.006
  - T1021.007
prerequisites:
  - T1021
severity_boost:
  T1021: "Chain with T1021 for deeper attack path"
  T1021.001: "Chain with T1021.001 for deeper attack path"
  T1021.002: "Chain with T1021.002 for deeper attack path"
---

# T1021.008 Direct Cloud VM Connections

> **Sub-technique of:** T1021

## High-Level Description

Adversaries may leverage Valid Accounts to log directly into accessible cloud hosted compute infrastructure through cloud native methods. Many cloud providers offer interactive connections to virtual infrastructure that can be accessed through the Cloud API, such as Azure Serial Console, AWS EC2 Instance Connect, and AWS System Manager..

Methods of authentication for these connections can include passwords, application access tokens, or SSH keys. These cloud native methods may, by default, allow for privileged access on the host with SYSTEM or root level access.

Adversaries may utilize these cloud native methods to directly access virtual infrastructure and pivot through an environment. These connections typically provide direct console access to the VM rather than the execution of scripts (i.e., Cloud Administration Command).

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Direct Cloud VM Connections technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Direct Cloud VM Connections
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Direct Cloud VM Connections by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1021.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Limit which users are allowed to access compute infrastructure via cloud native methods.

### M1042 Disable or Remove Feature or Program

If direct virtual machine connections are not required for administrative use, disable these connection types where feasible.

## Detection

### Detection of Direct VM Console Access via Cloud-Native Methods

## Risk Assessment

| Finding                                          | Severity | Impact           |
| ------------------------------------------------ | -------- | ---------------- |
| Direct Cloud VM Connections technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [EC2 Instance Connect](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-methods.html)
- [AWS System Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/what-is-systems-manager.html)
- [lucr-3: Getting SaaS-y in the cloud](https://permiso.io/blog/lucr-3-scattered-spider-getting-saas-y-in-the-cloud)
- [SIM Swapping and Abuse of the Microsoft Azure Serial Console](https://www.mandiant.com/resources/blog/sim-swapping-abuse-azure-serial)
- [Azure Serial Console](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/serial-console-overview)
- [Atomic Red Team - T1021.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021.008)
- [MITRE ATT&CK - T1021.008](https://attack.mitre.org/techniques/T1021/008)
