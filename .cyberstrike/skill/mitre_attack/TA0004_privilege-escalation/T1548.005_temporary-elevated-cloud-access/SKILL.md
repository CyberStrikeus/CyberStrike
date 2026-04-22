---
name: "T1548.005_temporary-elevated-cloud-access"
description: "Adversaries may abuse permission configurations that allow them to gain temporarily elevated access to cloud resources."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1548.005
  - privilege-escalation
  - defense-evasion
  - iaas
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1548.005"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - defense-evasion
platforms:
  - IaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1548/005"
tech_stack:
  - cloud
  - office
  - identity
cwe_ids:
  - CWE-269
chains_with:
  - T1548
  - T1548.001
  - T1548.002
  - T1548.003
  - T1548.004
  - T1548.006
prerequisites:
  - T1548
severity_boost:
  T1548: "Chain with T1548 for deeper attack path"
  T1548.001: "Chain with T1548.001 for deeper attack path"
  T1548.002: "Chain with T1548.002 for deeper attack path"
---

# T1548.005 Temporary Elevated Cloud Access

> **Sub-technique of:** T1548

## High-Level Description

Adversaries may abuse permission configurations that allow them to gain temporarily elevated access to cloud resources. Many cloud environments allow administrators to grant user or service accounts permission to request just-in-time access to roles, impersonate other accounts, pass roles onto resources and services, or otherwise gain short-term access to a set of privileges that may be distinct from their own. 

Just-in-time access is a mechanism for granting additional roles to cloud accounts in a granular, temporary manner. This allows accounts to operate with only the permissions they need on a daily basis, and to request additional permissions as necessary. Sometimes just-in-time access requests are configured to require manual approval, while other times the desired permissions are automatically granted.

Account impersonation allows user or service accounts to temporarily act with the permissions of another account. For example, in GCP users with the `iam.serviceAccountTokenCreator` role can create temporary access tokens or sign arbitrary payloads with the permissions of a service account, while service accounts with domain-wide delegation permission are permitted to impersonate Google Workspace accounts. In Exchange Online, the `ApplicationImpersonation` role allows a service account to use the permissions associated with specified user accounts. 

Many cloud environments also include mechanisms for users to pass roles to resources that allow them to perform tasks and authenticate to other services. While the user that creates the resource does not directly assume the role they pass to it, they may still be able to take advantage of the role's access -- for example, by configuring the resource to perform certain actions with the permissions it has been granted. In AWS, users with the `PassRole` permission can allow a service they create to assume a given role, while in GCP, users with the `iam.serviceAccountUser` role can attach a service account to a resource.

While users require specific role assignments in order to use any of these features, cloud administrators may misconfigure permissions. This could result in escalation paths that allow adversaries to gain access to resources beyond what was originally intended.

**Note:** this technique is distinct from Additional Cloud Roles, which involves assigning permanent roles to accounts rather than abusing existing permissions structures to gain temporarily elevated access to resources. However, adversaries that compromise a sufficiently privileged account may grant another account they control Additional Cloud Roles that would allow them to also abuse these features. This may also allow for greater stealth than would be had by directly using the highly privileged account, especially when logs do not clarify when role impersonation is taking place.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** IaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Temporary Elevated Cloud Access technique is applicable to target environment
- [ ] Check IaaS systems for indicators of Temporary Elevated Cloud Access
- [ ] Check Office Suite systems for indicators of Temporary Elevated Cloud Access
- [ ] Check Identity Provider systems for indicators of Temporary Elevated Cloud Access
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Temporary Elevated Cloud Access by examining the target platforms (IaaS, Office Suite, Identity Provider).

2. **Assess Existing Defenses**: Review whether mitigations for T1548.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management
Limit the privileges of cloud accounts to assume, create, or impersonate additional roles, policies, and permissions to only those required. Where just-in-time access is enabled, consider requiring manual approval for temporary elevation of privileges.


## Detection

### Detection Strategy for Temporary Elevated Cloud Access Abuse (T1548.005)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Temporary Elevated Cloud Access technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [AWS PassRole](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html)
- [CrowdStrike StellarParticle January 2022](https://www.crowdstrike.com/blog/observations-from-the-stellarparticle-campaign/)
- [Google Cloud Just in Time Access 2023](https://cloud.google.com/architecture/manage-just-in-time-privileged-access-to-project)
- [Google Cloud Service Account Authentication Roles](https://cloud.google.com/iam/docs/service-account-permissions)
- [Microsoft Impersonation and EWS in Exchange](https://learn.microsoft.com/en-us/exchange/client-developer/exchange-web-services/impersonation-and-ews-in-exchange)
- [Azure Just in Time Access 2023](https://learn.microsoft.com/en-us/azure/azure-resource-manager/managed-applications/approve-just-in-time-access)
- [Rhino Security Labs AWS Privilege Escalation](https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/)
- [Rhino Google Cloud Privilege Escalation](https://rhinosecuritylabs.com/gcp/privilege-escalation-google-cloud-platform-part-1/)
- [Hunters Domain Wide Delegation Google Workspace 2023](https://www.hunters.security/en/blog/delefriend-a-newly-discovered-design-flaw-in-domain-wide-delegation-could-leave-google-workspace-vulnerable-for-takeover)
- [Palo Alto Unit 42 Google Workspace Domain Wide Delegation 2023](https://unit42.paloaltonetworks.com/critical-risk-in-google-workspace-delegation-feature/)
- [Atomic Red Team - T1548.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1548.005)
- [MITRE ATT&CK - T1548.005](https://attack.mitre.org/techniques/T1548/005)
