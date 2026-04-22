---
name: "T1098.001_additional-cloud-credentials"
description: "Adversaries may add adversary-controlled credentials to a cloud account to maintain persistent access to victim accounts and instances within the environment."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1098.001
  - persistence
  - privilege-escalation
  - iaas
  - identity-provider
  - saas
  - sub-technique
technique_id: "T1098.001"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - IaaS
  - Identity Provider
  - SaaS
mitre_url: "https://attack.mitre.org/techniques/T1098/001"
tech_stack:
  - cloud
  - identity
  - saas
cwe_ids:
  - CWE-276
chains_with:
  - T1098
  - T1098.002
  - T1098.003
  - T1098.004
  - T1098.005
  - T1098.006
  - T1098.007
prerequisites:
  - T1098
severity_boost:
  T1098: "Chain with T1098 for deeper attack path"
  T1098.002: "Chain with T1098.002 for deeper attack path"
  T1098.003: "Chain with T1098.003 for deeper attack path"
---

# T1098.001 Additional Cloud Credentials

> **Sub-technique of:** T1098

## High-Level Description

Adversaries may add adversary-controlled credentials to a cloud account to maintain persistent access to victim accounts and instances within the environment.

For example, adversaries may add credentials for Service Principals and Applications in addition to existing legitimate credentials in Azure / Entra ID. These credentials include both x509 keys and passwords. With sufficient permissions, there are a variety of ways to add credentials including the Azure Portal, Azure command line interface, and Azure or Az PowerShell modules.

In infrastructure-as-a-service (IaaS) environments, after gaining access through Cloud Accounts, adversaries may generate or import their own SSH keys using either the <code>CreateKeyPair</code> or <code>ImportKeyPair</code> API in AWS or the <code>gcloud compute os-login ssh-keys add</code> command in GCP. This allows persistent access to instances within the cloud environment without further usage of the compromised cloud accounts.

Adversaries may also use the <code>CreateAccessKey</code> API in AWS or the <code>gcloud iam service-accounts keys create</code> command in GCP to add access keys to an account. Alternatively, they may use the <code>CreateLoginProfile</code> API in AWS to add a password that can be used to log into the AWS Management Console for Cloud Service Dashboard. If the target account has different permissions from the requesting account, the adversary may also be able to escalate their privileges in the environment (i.e. Cloud Accounts). For example, in Entra ID environments, an adversary with the Application Administrator role can add a new set of credentials to their application's service principal. In doing so the adversary would be able to access the service principal’s roles and permissions, which may be different from those of the Application Administrator. 

In AWS environments, adversaries with the appropriate permissions may also use the `sts:GetFederationToken` API call to create a temporary set of credentials to Forge Web Credentials tied to the permissions of the original user account. These temporary credentials may remain valid for the duration of their lifetime even if the original account’s API credentials are deactivated.


In Entra ID environments with the app password feature enabled, adversaries may be able to add an app password to a user account. As app passwords are intended to be used with legacy devices that do not support multi-factor authentication (MFA), adding an app password can allow an adversary to bypass MFA requirements. Additionally, app passwords may remain valid even if the user’s primary password is reset.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** IaaS, Identity Provider, SaaS

## What to Check

- [ ] Identify if Additional Cloud Credentials technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Additional Cloud Credentials
- [ ] Check Identity Provider systems for indicators of Additional Cloud Credentials
- [ ] Check SaaS systems for indicators of Additional Cloud Credentials
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Additional Cloud Credentials by examining the target platforms (IaaS, Identity Provider, SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1098.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication
Use multi-factor authentication for user and privileged accounts. Consider enforcing multi-factor authentication for the <code>CreateKeyPair</code> and <code>ImportKeyPair</code> API calls through IAM policies.

### M1018 User Account Management
Ensure that low-privileged user accounts do not have permission to add access keys to accounts. In AWS environments, prohibit users from calling the `sts:GetFederationToken` API unless explicitly required.

### M1030 Network Segmentation
Configure access controls and firewalls to limit access to critical systems and domain controllers. Most cloud environments support separate virtual private cloud (VPC) instances that enable further segmentation of cloud systems.

### M1026 Privileged Account Management
Do not allow domain administrator or root accounts to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.

### M1042 Disable or Remove Feature or Program
Remove unnecessary and potentially abusable authentication mechanisms where possible. For example, in Entra ID environments, disable the app password feature unless explicitly required.


## Detection

### Detection Strategy for Additional Cloud Credentials in IaaS/IdP/SaaS


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Additional Cloud Credentials technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Crowdstrike AWS User Federation Persistence](https://www.crowdstrike.com/blog/how-adversaries-persist-with-aws-user-federation/)
- [Expel IO Evil in AWS](https://expel.io/blog/finding-evil-in-aws/)
- [SpecterOps Azure Privilege Escalation](https://posts.specterops.io/azure-privilege-escalation-via-service-principal-abuse-210ae2be2a5)
- [Demystifying Azure AD Service Principals](https://nedinthecloud.com/2019/07/16/demystifying-azure-ad-service-principals/)
- [Lacework AI Resource Hijacking 2024](https://www.lacework.com/blog/detecting-ai-resource-hijacking-with-composite-alerts)
- [GCP SSH Key Add](https://cloud.google.com/sdk/gcloud/reference/compute/os-login/ssh-keys/add)
- [Permiso Scattered Spider 2023](https://permiso.io/blog/lucr-3-scattered-spider-getting-saas-y-in-the-cloud)
- [Blue Cloud of Death Video](https://www.youtube.com/watch?v=wQ1CuAPnrLM&feature=youtu.be&t=2815)
- [Blue Cloud of Death](https://speakerdeck.com/tweekfawkes/blue-cloud-of-death-red-teaming-azure-1)
- [Microsoft Entra ID App Passwords](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-mfa-app-passwords)
- [Microsoft SolarWinds Customer Guidance](https://msrc-blog.microsoft.com/2020/12/13/customer-guidance-on-recent-nation-state-cyber-attacks/)
- [Mandiant APT42 Operations 2024](https://cloud.google.com/blog/topics/threat-intelligence/untangling-iran-apt42-operations)
- [Expel Behind the Scenes](https://expel.io/blog/behind-the-scenes-expel-soc-alert-aws/)
- [Sysdig ScarletEel 2.0](https://sysdig.com/blog/scarleteel-2-0/)
- [Rhino Security Labs AWS Privilege Escalation](https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/)
- [Atomic Red Team - T1098.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1098.001)
- [MITRE ATT&CK - T1098.001](https://attack.mitre.org/techniques/T1098/001)
