---
name: "T1087.004_cloud-account"
description: "Adversaries may attempt to get a listing of cloud accounts."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1087.004
  - discovery
  - iaas
  - identity-provider
  - office-suite
  - saas
  - sub-technique
technique_id: "T1087.004"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - IaaS
  - Identity Provider
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1087/004"
tech_stack:
  - cloud
  - identity
  - office
  - saas
cwe_ids:
  - CWE-200
chains_with:
  - T1087
  - T1087.001
  - T1087.002
  - T1087.003
prerequisites:
  - T1087
severity_boost:
  T1087: "Chain with T1087 for deeper attack path"
  T1087.001: "Chain with T1087.001 for deeper attack path"
  T1087.002: "Chain with T1087.002 for deeper attack path"
---

# T1087.004 Cloud Account

> **Sub-technique of:** T1087

## High-Level Description

Adversaries may attempt to get a listing of cloud accounts. Cloud accounts are those created and configured by an organization for use by users, remote support, services, or for administration of resources within a cloud service provider or SaaS application.

With authenticated access there are several tools that can be used to find accounts. The <code>Get-MsolRoleMember</code> PowerShell cmdlet can be used to obtain account names given a role or permissions group in Office 365. The Azure CLI (AZ CLI) also provides an interface to obtain user accounts with authenticated access to a domain. The command <code>az ad user list</code> will list all users within a domain.

The AWS command <code>aws iam list-users</code> may be used to obtain a list of users in the current account while <code>aws iam list-roles</code> can obtain IAM roles that have a specified path prefix. In GCP, <code>gcloud iam service-accounts list</code> and <code>gcloud projects get-iam-policy</code> may be used to obtain a listing of service accounts and users in a project.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** IaaS, Identity Provider, Office Suite, SaaS

## What to Check

- [ ] Identify if Cloud Account technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Account
- [ ] Check Identity Provider systems for indicators of Cloud Account
- [ ] Check Office Suite systems for indicators of Cloud Account
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Account by examining the target platforms (IaaS, Identity Provider, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1087.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Routinely check user permissions to ensure only the expected users have the ability to list IAM identities or otherwise discover cloud accounts.

### M1018 User Account Management

Limit permissions to discover cloud accounts in accordance with least privilege. Organizations should limit the number of users within the organization with an IAM role that has administrative privileges, strive to reduce all permanent privileged role assignments, and conduct periodic entitlement reviews on IAM users, roles and policies.

## Detection

### Cloud Account Enumeration via API, CLI, and Scripting Interfaces

## Risk Assessment

| Finding                            | Severity | Impact    |
| ---------------------------------- | -------- | --------- |
| Cloud Account technique applicable | Low      | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [AWS List Roles](https://docs.aws.amazon.com/cli/latest/reference/iam/list-roles.html)
- [AWS List Users](https://docs.aws.amazon.com/cli/latest/reference/iam/list-users.html)
- [Black Hills Red Teaming MS AD Azure, 2018](https://www.blackhillsinfosec.com/red-teaming-microsoft-part-1-active-directory-leaks-via-azure/)
- [Google Cloud - IAM Servie Accounts List API](https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/list)
- [Microsoft AZ CLI](https://docs.microsoft.com/en-us/cli/azure/ad/user?view=azure-cli-latest)
- [Microsoft msolrolemember](https://docs.microsoft.com/en-us/powershell/module/msonline/get-msolrolemember?view=azureadps-1.0)
- [GitHub Raindance](https://github.com/True-Demon/raindance)
- [Atomic Red Team - T1087.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1087.004)
- [MITRE ATT&CK - T1087.004](https://attack.mitre.org/techniques/T1087/004)
