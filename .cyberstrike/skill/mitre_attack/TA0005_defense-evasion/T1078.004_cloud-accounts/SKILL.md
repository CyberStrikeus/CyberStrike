---
name: "T1078.004_cloud-accounts"
description: "Valid accounts in cloud environments may allow adversaries to perform actions to achieve Initial Access, Persistence, Privilege Escalation, or Defense Evasion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1078.004
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
  - iaas
  - identity-provider
  - office-suite
  - saas
  - sub-technique
technique_id: "T1078.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
platforms:
  - IaaS
  - Identity Provider
  - Office Suite
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1078/004"
tech_stack:
  - cloud
  - identity
  - office
  - saas
cwe_ids:
  - CWE-693
chains_with:
  - T1078
  - T1078.001
  - T1078.002
  - T1078.003
prerequisites:
  - T1078
severity_boost:
  T1078: "Chain with T1078 for deeper attack path"
  T1078.001: "Chain with T1078.001 for deeper attack path"
  T1078.002: "Chain with T1078.002 for deeper attack path"
---

# T1078.004 Cloud Accounts

> **Sub-technique of:** T1078

## High-Level Description

Valid accounts in cloud environments may allow adversaries to perform actions to achieve Initial Access, Persistence, Privilege Escalation, or Defense Evasion. Cloud accounts are those created and configured by an organization for use by users, remote support, services, or for administration of resources within a cloud service provider or SaaS application. Cloud Accounts can exist solely in the cloud; alternatively, they may be hybrid-joined between on-premises systems and the cloud through syncing or federation with other identity sources such as Windows Active Directory.

Service or user accounts may be targeted by adversaries through Brute Force, Phishing, or various other means to gain access to the environment. Federated or synced accounts may be a pathway for the adversary to affect both on-premises systems and cloud environments - for example, by leveraging shared credentials to log onto Remote Services. High privileged cloud accounts, whether federated, synced, or cloud-only, may also allow pivoting to on-premises environments by leveraging SaaS-based Software Deployment Tools to run commands on hybrid-joined devices.

An adversary may create long lasting Additional Cloud Credentials on a compromised cloud account to maintain persistence in the environment. Such credentials may also be used to bypass security controls such as multi-factor authentication.

Cloud accounts may also be able to assume Temporary Elevated Cloud Access or other privileges through various means within the environment. Misconfigurations in role assignments or role assumption policies may allow an adversary to use these mechanisms to leverage permissions outside the intended scope of the account. Such over privileged accounts may be used to harvest sensitive data from online storage accounts and databases through Cloud API or other methods. For example, in Azure environments, adversaries may target Azure Managed Identities, which allow associated Azure resources to request access tokens. By compromising a resource with an attached Managed Identity, such as an Azure VM, adversaries may be able to Steal Application Access Tokens to move laterally across the cloud environment.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Initial Access (TA0001)

**Platforms:** IaaS, Identity Provider, Office Suite, SaaS

## What to Check

- [ ] Identify if Cloud Accounts technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Cloud Accounts
- [ ] Check Identity Provider systems for indicators of Cloud Accounts
- [ ] Check Office Suite systems for indicators of Cloud Accounts
- [ ] Verify mitigations are bypassed or absent (7 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cloud Accounts by examining the target platforms (IaaS, Identity Provider, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1078.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1027 Password Policies

Ensure that cloud accounts, particularly privileged accounts, have complex, unique passwords across all systems on the network. Passwords and access keys should be rotated regularly. This limits the amount of time credentials can be used to access resources if a credential is compromised without your knowledge. Cloud service providers may track access key age to help audit and identify keys that may need to be rotated.

### M1015 Active Directory Configuration

Disable legacy authentication, which does not support MFA, and require the use of modern authentication protocols instead.

### M1026 Privileged Account Management

Review privileged cloud account permission levels routinely to look for those that could allow an adversary to gain wide access, such as Global Administrator and Privileged Role Administrator in Azure AD. These reviews should also check if new privileged cloud accounts have been created that were not authorized. For example, in Azure AD environments configure alerts to notify when accounts have gone many days without using privileged roles, as these roles may be able to be removed. Consider using temporary, just-in-time (JIT) privileged access to Azure AD resources rather than permanently assigning privileged roles.

### M1032 Multi-factor Authentication

Use multi-factor authentication for cloud accounts, especially privileged accounts. This can be implemented in a variety of forms (e.g. hardware, virtual, SMS), and can also be audited using administrative reporting features.

### M1036 Account Use Policies

Use conditional access policies to block logins from non-compliant devices or from outside defined organization IP ranges.

### M1017 User Training

Applications may send push notifications to verify a login as a form of multi-factor authentication (MFA). Train users to only accept valid push notifications and to report suspicious push notifications.

### M1018 User Account Management

Periodically review user accounts and remove those that are inactive or unnecessary. Limit the ability for user accounts to create additional accounts.

## Detection

### Detection of Abused or Compromised Cloud Accounts for Access and Persistence

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| Cloud Accounts technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [AWS Identity Federation](https://aws.amazon.com/identity/federation/)
- [SpecterOps Managed Identity 2022](https://posts.specterops.io/managed-identity-attack-paths-part-1-automation-accounts-82667d17187a?gi=6a9daedade1c)
- [Google Federating GC](https://cloud.google.com/solutions/federating-gcp-with-active-directory-introduction)
- [Microsoft Deploying AD Federation](https://docs.microsoft.com/en-us/windows-server/identity/ad-fs/deployment/how-to-connect-fed-azure-adfs)
- [Atomic Red Team - T1078.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1078.004)
- [MITRE ATT&CK - T1078.004](https://attack.mitre.org/techniques/T1078/004)
