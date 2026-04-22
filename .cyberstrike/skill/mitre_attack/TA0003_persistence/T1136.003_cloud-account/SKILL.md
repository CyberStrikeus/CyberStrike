---
name: "T1136.003_cloud-account"
description: "Adversaries may create a cloud account to maintain access to victim systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1136.003
  - persistence
  - iaas
  - saas
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1136.003"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - IaaS
  - SaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1136/003"
tech_stack:
  - cloud
  - saas
  - office
  - identity
cwe_ids:
  - CWE-276
chains_with:
  - T1136
  - T1136.001
  - T1136.002
prerequisites:
  - T1136
severity_boost:
  T1136: "Chain with T1136 for deeper attack path"
  T1136.001: "Chain with T1136.001 for deeper attack path"
  T1136.002: "Chain with T1136.002 for deeper attack path"
---

# T1136.003 Cloud Account

> **Sub-technique of:** T1136

## High-Level Description

Adversaries may create a cloud account to maintain access to victim systems. With a sufficient level of access, such accounts may be used to establish secondary credentialed access that does not require persistent remote access tools to be deployed on the system.

In addition to user accounts, cloud accounts may be associated with services. Cloud providers handle the concept of service accounts in different ways. In Azure, service accounts include service principals and managed identities, which can be linked to various resources such as OAuth applications, serverless functions, and virtual machines in order to grant those resources permissions to perform various activities in the environment. In GCP, service accounts can also be linked to specific resources, as well as be impersonated by other accounts for Temporary Elevated Cloud Access. While AWS has no specific concept of service accounts, resources can be directly granted permission to assume roles.

Adversaries may create accounts that only have access to specific cloud services, which can reduce the chance of detection.

Once an adversary has created a cloud account, they can then manipulate that account to ensure persistence and allow access to additional resources - for example, by adding Additional Cloud Credentials or assigning Additional Cloud Roles.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** IaaS, SaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Cloud Account technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Account
- [ ] Check SaaS systems for indicators of Cloud Account
- [ ] Check Office Suite systems for indicators of Cloud Account
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Account by examining the target platforms (IaaS, SaaS, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1136.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1030 Network Segmentation
Configure access controls and firewalls to limit access to critical systems and domain controllers. Most cloud environments support separate virtual private cloud (VPC) instances that enable further segmentation of cloud systems.

### M1032 Multi-factor Authentication
Use multi-factor authentication for user and privileged accounts.

### M1026 Privileged Account Management
Limit the number of accounts with permissions to create other accounts. Do not allow privileged accounts to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.


## Detection

### Detection Strategy for T1136.003 - Cloud Account Creation across IaaS, IdP, SaaS, Office


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Cloud Account technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft O365 Admin Roles](https://docs.microsoft.com/en-us/office365/admin/add-users/about-admin-roles?view=o365-worldwide)
- [AWS Create IAM User](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html)
- [AWS Lambda Execution Role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
- [AWS Instance Profiles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html)
- [GCP Create Cloud Identity Users](https://support.google.com/cloudidentity/answer/7332836?hl=en&ref_topic=7558554)
- [GCP Service Accounts](https://cloud.google.com/iam/docs/service-account-overview)
- [Microsoft Azure AD Users](https://docs.microsoft.com/en-us/azure/active-directory/fundamentals/add-users-azure-active-directory)
- [Microsoft Entra ID Service Principals](https://learn.microsoft.com/en-us/entra/identity-platform/app-objects-and-service-principals?tabs=browser)
- [Microsoft Support O365 Add Another Admin, October 2019](https://support.office.com/en-us/article/add-another-admin-f693489f-9f55-4bd0-a637-a81ce93de22d)
- [Atomic Red Team - T1136.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1136.003)
- [MITRE ATT&CK - T1136.003](https://attack.mitre.org/techniques/T1136/003)
