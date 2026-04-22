---
name: "T1098.003_additional-cloud-roles"
description: "An adversary may add additional roles or permissions to an adversary-controlled cloud account to maintain persistent access to a tenant."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1098.003
  - persistence
  - privilege-escalation
  - iaas
  - identity-provider
  - office-suite
  - saas
  - sub-technique
technique_id: "T1098.003"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - IaaS
  - Identity Provider
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1098/003"
tech_stack:
  - cloud
  - identity
  - office
  - saas
cwe_ids:
  - CWE-276
chains_with:
  - T1098
  - T1098.001
  - T1098.002
  - T1098.004
  - T1098.005
  - T1098.006
  - T1098.007
prerequisites:
  - T1098
severity_boost:
  T1098: "Chain with T1098 for deeper attack path"
  T1098.001: "Chain with T1098.001 for deeper attack path"
  T1098.002: "Chain with T1098.002 for deeper attack path"
---

# T1098.003 Additional Cloud Roles

> **Sub-technique of:** T1098

## High-Level Description

An adversary may add additional roles or permissions to an adversary-controlled cloud account to maintain persistent access to a tenant. For example, adversaries may update IAM policies in cloud-based environments or add a new global administrator in Office 365 environments. With sufficient permissions, a compromised account can gain almost unlimited access to data and settings (including the ability to reset the passwords of other admins).

This account modification may immediately follow Create Account or other malicious account activity. Adversaries may also modify existing Valid Accounts that they have compromised. This could lead to privilege escalation, particularly if the roles added allow for lateral movement to additional accounts.

For example, in AWS environments, an adversary with appropriate permissions may be able to use the <code>CreatePolicyVersion</code> API to define a new version of an IAM policy or the <code>AttachUserPolicy</code> API to attach an IAM policy with additional or distinct permissions to a compromised user account.

In some cases, adversaries may add roles to adversary-controlled accounts outside the victim cloud tenant. This allows these external accounts to perform actions inside the victim tenant without requiring the adversary to Create Account or modify a victim-owned account.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** IaaS, Identity Provider, Office Suite, SaaS

## What to Check

- [ ] Identify if Additional Cloud Roles technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Additional Cloud Roles
- [ ] Check Identity Provider systems for indicators of Additional Cloud Roles
- [ ] Check Office Suite systems for indicators of Additional Cloud Roles
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Additional Cloud Roles by examining the target platforms (IaaS, Identity Provider, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1098.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Ensure that all accounts use the least privileges they require. In Azure AD environments, consider using Privileged Identity Management (PIM) to define roles that require two or more approvals before assignment to users.

### M1032 Multi-factor Authentication

Use multi-factor authentication for user and privileged accounts.

### M1018 User Account Management

Ensure that low-privileged user accounts do not have permissions to add permissions to accounts or update IAM policies.

## Detection

### Detection Strategy for Role Addition to Cloud Accounts

## Risk Assessment

| Finding                                     | Severity | Impact      |
| ------------------------------------------- | -------- | ----------- |
| Additional Cloud Roles technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Expel AWS Attacker](https://expel.com/blog/incident-report-from-cli-to-console-chasing-an-attacker-in-aws/)
- [Microsoft O365 Admin Roles](https://docs.microsoft.com/en-us/office365/admin/add-users/about-admin-roles?view=o365-worldwide)
- [AWS IAM Policies and Permissions](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html)
- [Google Cloud IAM Policies](https://cloud.google.com/iam/docs/policies)
- [Invictus IR DangerDev 2024](https://www.invictus-ir.com/news/the-curious-case-of-dangerdev-protonmail-me)
- [Microsoft Support O365 Add Another Admin, October 2019](https://support.office.com/en-us/article/add-another-admin-f693489f-9f55-4bd0-a637-a81ce93de22d)
- [Rhino Security Labs AWS Privilege Escalation](https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/)
- [Atomic Red Team - T1098.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1098.003)
- [MITRE ATT&CK - T1098.003](https://attack.mitre.org/techniques/T1098/003)
