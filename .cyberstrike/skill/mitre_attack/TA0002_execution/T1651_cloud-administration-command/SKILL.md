---
name: "T1651_cloud-administration-command"
description: "Adversaries may abuse cloud management services to execute commands within virtual machines."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1651
  - execution
  - iaas
technique_id: "T1651"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1651"
tech_stack:
  - cloud
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1651 Cloud Administration Command

## High-Level Description

Adversaries may abuse cloud management services to execute commands within virtual machines. Resources such as AWS Systems Manager, Azure RunCommand, and Runbooks allow users to remotely run scripts in virtual machines by leveraging installed virtual machine agents.

If an adversary gains administrative access to a cloud environment, they may be able to abuse cloud management services to execute commands in the environment’s virtual machines. Additionally, an adversary that compromises a service provider or delegated administrator account may similarly be able to leverage a Trusted Relationship to execute commands in connected virtual machines.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Cloud Administration Command technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Administration Command
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Administration Command by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1651 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Limit the number of cloud accounts with permissions to remotely execute commands on virtual machines, and ensure that these are not used for day-to-day operations. In Azure, limit the number of accounts with the roles Azure Virtual Machine Contributer and above, and consider using temporary Just-in-Time (JIT) roles to avoid permanently assigning privileged access to virtual machines.

## Detection

### Detection Strategy for Cloud Administration Command

## Risk Assessment

| Finding                                           | Severity | Impact    |
| ------------------------------------------------- | -------- | --------- |
| Cloud Administration Command technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [AWS Systems Manager Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html)
- [MSTIC Nobelium Oct 2021](https://www.microsoft.com/security/blog/2021/10/25/nobelium-targeting-delegated-administrative-privileges-to-facilitate-broader-attacks/)
- [Microsoft Run Command](https://learn.microsoft.com/en-us/azure/virtual-machines/run-command-overview)
- [Atomic Red Team - T1651](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1651)
- [MITRE ATT&CK - T1651](https://attack.mitre.org/techniques/T1651)
