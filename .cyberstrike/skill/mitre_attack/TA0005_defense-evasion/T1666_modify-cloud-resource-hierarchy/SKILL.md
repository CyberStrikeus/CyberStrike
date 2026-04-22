---
name: "T1666_modify-cloud-resource-hierarchy"
description: "Adversaries may attempt to modify hierarchical structures in infrastructure-as-a-service (IaaS) environments in order to evade defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1666
  - defense-evasion
  - iaas
technique_id: "T1666"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - IaaS
mitre_url: "https://attack.mitre.org/techniques/T1666"
tech_stack:
  - cloud
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1666 Modify Cloud Resource Hierarchy

## High-Level Description

Adversaries may attempt to modify hierarchical structures in infrastructure-as-a-service (IaaS) environments in order to evade defenses. 

IaaS environments often group resources into a hierarchy, enabling improved resource management and application of policies to relevant groups. Hierarchical structures differ among cloud providers. For example, in AWS environments, multiple accounts can be grouped under a single organization, while in Azure environments, multiple subscriptions can be grouped under a single management group.

Adversaries may add, delete, or otherwise modify resource groups within an IaaS hierarchy. For example, in Azure environments, an adversary who has gained access to a Global Administrator account may create new subscriptions in which to deploy resources. They may also engage in subscription hijacking by transferring an existing pay-as-you-go subscription from a victim tenant to an adversary-controlled tenant. This will allow the adversary to use the victim’s compute resources without generating logs on the victim tenant.

In AWS environments, adversaries with appropriate permissions in a given account may call the `LeaveOrganization` API, causing the account to be severed from the AWS Organization to which it was tied and removing any Service Control Policies, guardrails, or restrictions imposed upon it by its former Organization. Alternatively, adversaries may call the `CreateAccount` API in order to create a new account within an AWS Organization. This account will use the same payment methods registered to the payment account but may not be subject to existing detections or Service Control Policies.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** IaaS

## What to Check

- [ ] Identify if Modify Cloud Resource Hierarchy technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Modify Cloud Resource Hierarchy
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Modify Cloud Resource Hierarchy by examining the target platforms (IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1666 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1054 Software Configuration
In Azure environments, consider setting a policy to block subscription transfers. In AWS environments, consider using Service Control Policies to prevent the use of the `LeaveOrganization` API call.

### M1018 User Account Management
Limit permissions to add, delete, or modify resource groups to only those required.

### M1047 Audit
Periodically audit resource groups in the cloud management console to ensure that only expected items exist, especially close to the top of the hierarchy (e.g., AWS accounts and Azure subscriptions). Typically, top-level accounts (such as the AWS management account) should not contain any workloads or resources.


## Detection

### Detection Strategy for Modify Cloud Resource Hierarchy


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Modify Cloud Resource Hierarchy technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [AWS Organizations](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_getting-started_concepts.html)
- [AWS RE:Inforce Threat Detection 2024](https://reinforce.awsevents.com/content/dam/reinforce/2024/slides/TDR432_New-tactics-and-techniques-for-proactive-threat-detection.pdf)
- [Microsoft Subscription Hijacking 2022](https://techcommunity.microsoft.com/t5/microsoft-365-defender-blog/hunt-for-compromised-azure-subscriptions-using-microsoft/ba-p/3607121)
- [Microsoft Azure Resources](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-setup-guide/organize-resources)
- [Microsoft Peach Sandstorm 2023](https://www.microsoft.com/en-us/security/blog/2023/09/14/peach-sandstorm-password-spray-campaigns-enable-intelligence-collection-at-high-value-targets/)
- [Atomic Red Team - T1666](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1666)
- [MITRE ATT&CK - T1666](https://attack.mitre.org/techniques/T1666)
