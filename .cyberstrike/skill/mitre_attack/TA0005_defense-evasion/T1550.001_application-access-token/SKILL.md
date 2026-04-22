---
name: "T1550.001_application-access-token"
description: "Adversaries may use stolen application access tokens to bypass the typical authentication process and access restricted accounts, information, or services on remote systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1550.001
  - defense-evasion
  - lateral-movement
  - saas
  - containers
  - iaas
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1550.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - lateral-movement
platforms:
  - SaaS
  - Containers
  - IaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1550/001"
tech_stack:
  - saas
  - containers
  - cloud
  - office
  - identity
cwe_ids:
  - CWE-693
chains_with:
  - T1550
  - T1550.002
  - T1550.003
  - T1550.004
prerequisites:
  - T1550
severity_boost:
  T1550: "Chain with T1550 for deeper attack path"
  T1550.002: "Chain with T1550.002 for deeper attack path"
  T1550.003: "Chain with T1550.003 for deeper attack path"
---

# T1550.001 Application Access Token

> **Sub-technique of:** T1550

## High-Level Description

Adversaries may use stolen application access tokens to bypass the typical authentication process and access restricted accounts, information, or services on remote systems. These tokens are typically stolen from users or services and used in lieu of login credentials.

Application access tokens are used to make authorized API requests on behalf of a user or service and are commonly used to access resources in cloud, container-based applications, and software-as-a-service (SaaS).

OAuth is one commonly implemented framework that issues tokens to users for access to systems. These frameworks are used collaboratively to verify the user and determine what actions the user is allowed to perform. Once identity is established, the token allows actions to be authorized, without passing the actual credentials of the user. Therefore, compromise of the token can grant the adversary access to resources of other sites through a malicious application.

For example, with a cloud-based email service, once an OAuth access token is granted to a malicious application, it can potentially gain long-term access to features of the user account if a "refresh" token enabling background access is awarded. With an OAuth access token an adversary can use the user-granted REST API to perform functions such as email searching and contact enumeration.

Compromised access tokens may be used as an initial step in compromising other services. For example, if a token grants access to a victim’s primary email, the adversary may be able to extend access to all other services which the target subscribes by triggering forgotten password routines. In AWS and GCP environments, adversaries can trigger a request for a short-lived access token with the privileges of another user account. The adversary can then use this token to request data or perform actions the original account could not. If permissions for this feature are misconfigured – for example, by allowing all users to request a token for a particular account - an adversary may be able to gain initial access to a Cloud Account or escalate their privileges.

Direct API access through a token negates the effectiveness of a second authentication factor and may be immune to intuitive countermeasures like changing passwords. For example, in AWS environments, an adversary who compromises a user’s AWS API credentials may be able to use the `sts:GetFederationToken` API call to create a federated user session, which will have the same permissions as the original user but may persist even if the original user credentials are deactivated. Additionally, access abuse over an API channel can be difficult to detect even from the service provider end, as the access can still align well with a legitimate workflow.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Lateral Movement (TA0008)

**Platforms:** SaaS, Containers, IaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Application Access Token technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Application Access Token
- [ ] Check Containers systems for indicators of Application Access Token
- [ ] Check IaaS systems for indicators of Application Access Token
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Application Access Token by examining the target platforms (SaaS, Containers, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1550.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1036 Account Use Policies

Where possible, consider restricting the use of access tokens outside of expected contexts. For example, in AWS environments, consider using data perimeters to prevent credential use outside of an expected network.

### M1047 Audit

Administrators should audit all cloud and container accounts to ensure that they are necessary and that the permissions granted to them are appropriate. Where possible, the ability to request temporary account tokens on behalf of another accounts should be disabled. Additionally, administrators can leverage audit tools to monitor actions that can be conducted as a result of OAuth 2.0 access. For instance, audit reports enable admins to identify privilege escalation actions such as role creations or policy modifications, which could be actions performed after initial access.

### M1021 Restrict Web-Based Content

Update corporate policies to restrict what types of third-party applications may be added to any online service or tool that is linked to the company's information, accounts or network (e.g., Google, Microsoft, Dropbox, Basecamp, GitHub). However, rather than providing high-level guidance on this, be extremely specific—include a list of per-approved applications and deny all others not on the list. Administrators may also block end-user consent through administrative portals, such as the Azure Portal, disabling users from authorizing third-party apps through OAuth and forcing administrative consent.

### M1013 Application Developer Guidance

Consider implementing token binding strategies, such as Azure AD token protection or OAuth Proof of Possession, that cryptographically bind a token to a secret. This may prevent the token from being used without knowledge of the secret or possession of the device the token is tied to.

### M1041 Encrypt Sensitive Information

File encryption should be enforced across email communications containing sensitive information that may be obtained through access to email services.

## Detection

### Behavioral Detection Strategy for Use Alternate Authentication Material: Application Access Token (T1550.001)

## Risk Assessment

| Finding                                       | Severity | Impact          |
| --------------------------------------------- | -------- | --------------- |
| Application Access Token technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Crowdstrike AWS User Federation Persistence](https://www.crowdstrike.com/blog/how-adversaries-persist-with-aws-user-federation/)
- [Auth0 - Why You Should Always Use Access Tokens to Secure APIs Sept 2019](https://auth0.com/blog/why-should-use-accesstokens-to-secure-an-api/)
- [AWS Logging IAM Calls](https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-integration.html)
- [AWS Temporary Security Credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_request.html)
- [Microsoft Identity Platform Access 2019](https://docs.microsoft.com/en-us/azure/active-directory/develop/access-tokens)
- [Google Cloud Service Account Credentials](https://cloud.google.com/iam/docs/creating-short-lived-service-account-credentials)
- [GCP Monitoring Service Account Usage](https://cloud.google.com/iam/docs/service-account-monitoring)
- [okta](https://developer.okta.com/blog/2018/06/20/what-happens-if-your-jwt-is-stolen)
- [Rhino Security Labs Enumerating AWS Roles](https://rhinosecuritylabs.com/aws/assume-worst-aws-assume-role-enumeration)
- [Staaldraad Phishing with OAuth 2017](https://staaldraad.github.io/2017/08/02/o356-phishing-with-oauth/)
- [Atomic Red Team - T1550.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1550.001)
- [MITRE ATT&CK - T1550.001](https://attack.mitre.org/techniques/T1550/001)
