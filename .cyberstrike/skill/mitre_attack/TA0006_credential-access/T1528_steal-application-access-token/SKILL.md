---
name: "T1528_steal-application-access-token"
description: "Adversaries can steal application access tokens as a means of acquiring credentials to access remote systems and resources."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1528
  - credential-access
  - saas
  - containers
  - iaas
  - office-suite
  - identity-provider
technique_id: "T1528"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - SaaS
  - Containers
  - IaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1528"
tech_stack:
  - saas
  - containers
  - cloud
  - office
  - identity
cwe_ids:
  - CWE-522
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1528 Steal Application Access Token

## High-Level Description

Adversaries can steal application access tokens as a means of acquiring credentials to access remote systems and resources.

Application access tokens are used to make authorized API requests on behalf of a user or service and are commonly used as a way to access resources in cloud and container-based applications and software-as-a-service (SaaS). Adversaries who steal account API tokens in cloud and containerized environments may be able to access data and perform actions with the permissions of these accounts, which can lead to privilege escalation and further compromise of the environment.

For example, in Kubernetes environments, processes running inside a container may communicate with the Kubernetes API server using service account tokens. If a container is compromised, an adversary may be able to steal the container’s token and thereby gain access to Kubernetes API commands. 

Similarly, instances within continuous-development / continuous-integration (CI/CD) pipelines will often use API tokens to authenticate to other services for testing and deployment. If these pipelines are compromised, adversaries may be able to steal these tokens and leverage their privileges. 

In Azure, an adversary who compromises a resource with an attached Managed Identity, such as an Azure VM, can request short-lived tokens through the Azure Instance Metadata Service (IMDS). These tokens can then facilitate unauthorized actions or further access to other Azure services, bypassing typical credential-based authentication.

Token theft can also occur through social engineering, in which case user action may be required to grant access. OAuth is one commonly implemented framework that issues tokens to users for access to systems. An application desiring access to cloud-based services or protected APIs can gain entry using OAuth 2.0 through a variety of authorization protocols. An example commonly-used sequence is Microsoft's Authorization Code Grant flow. An OAuth access token enables a third-party application to interact with resources containing user data in the ways requested by the application without obtaining user credentials. 
 
Adversaries can leverage OAuth authorization by constructing a malicious application designed to be granted access to resources with the target user's OAuth token. The adversary will need to complete registration of their application with the authorization server, for example Microsoft Identity Platform using Azure Portal, the Visual Studio IDE, the command-line interface, PowerShell, or REST API calls. Then, they can send a Spearphishing Link to the target user to entice them to grant access to the application. Once the OAuth access token is granted, the application can gain potentially long-term access to features of the user account through Application Access Token.

Application access tokens may function within a limited lifetime, limiting how long an adversary can utilize the stolen token. However, in some cases, adversaries can also steal application refresh tokens, allowing them to obtain new access tokens without prompting the user.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** SaaS, Containers, IaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Steal Application Access Token technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Steal Application Access Token
- [ ] Check Containers systems for indicators of Steal Application Access Token
- [ ] Check IaaS systems for indicators of Steal Application Access Token
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Steal Application Access Token by examining the target platforms (SaaS, Containers, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1528 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1021 Restrict Web-Based Content
Administrators can block end-user consent to OAuth applications, disabling users from authorizing third-party apps through OAuth 2.0 and forcing administrative consent for all requests. They can also block end-user registration of applications by their users, to reduce risk. A Cloud Access Security Broker can also be used to ban applications.

Azure offers a couple of enterprise policy settings in the Azure Management Portal that may help:

"Users -> User settings -> App registrations: Users can register applications" can be set to "no" to prevent users from registering new applications. 
"Enterprise applications -> User settings -> Enterprise applications: Users can consent to apps accessing company data on their behalf" can be set to "no" to prevent users from consenting to allow third-party multi-tenant applications

### M1047 Audit
Administrators should audit all cloud and container accounts to ensure that they are necessary and that the permissions granted to them are appropriate. Additionally, administrators should perform an audit of all OAuth applications and the permissions they have been granted to access organizational data. This should be done extensively on all applications in order to establish a baseline, followed up on with periodic audits of new or updated applications. Suspicious applications should be investigated and removed.

### M1017 User Training
Users need to be trained to not authorize third-party applications they don’t recognize. The user should pay particular attention to the redirect URL: if the URL is a misspelled or convoluted sequence of words related to an expected service or SaaS application, the website is likely trying to spoof a legitimate service. Users should also be cautious about the permissions they are granting to apps. For example, offline access and access to read emails should excite higher suspicions because adversaries can utilize SaaS APIs to discover credentials and other sensitive communications.

### M1018 User Account Management
Enforce role-based access control to limit accounts to the least privileges they require. A Cloud Access Security Broker (CASB) can be used to set usage policies and manage user permissions on cloud applications to prevent access to application access tokens. In Kubernetes applications, set “automountServiceAccountToken: false” in the YAML specification of pods that do not require access to service account tokens.


## Detection

### Detection Strategy for T1528 - Steal Application Access Token


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Steal Application Access Token technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Amnesty OAuth Phishing Attacks, August 2019](https://www.amnesty.org/en/latest/research/2019/08/evolving-phishing-attacks-targeting-journalists-and-human-rights-defenders-from-the-middle-east-and-north-africa/)
- [SpecterOps Managed Identity 2022](https://posts.specterops.io/managed-identity-attack-paths-part-1-automation-accounts-82667d17187a?gi=6a9daedade1c)
- [Auth0 Understanding Refresh Tokens](https://auth0.com/learn/refresh-tokens)
- [Auth0 - Why You Should Always Use Access Tokens to Secure APIs Sept 2019](https://auth0.com/blog/why-should-use-accesstokens-to-secure-an-api/)
- [Cider Security Top 10 CICD Security Risks](https://web.archive.org/web/20220316130828/https://www.cidersecurity.io/top-10-cicd-security-risks/)
- [Trend Micro Pawn Storm OAuth 2017](https://blog.trendmicro.com/trendlabs-security-intelligence/pawn-storm-abuses-open-authentication-advanced-social-engineering-attacks)
- [Kubernetes Service Accounts](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/)
- [Entra Managed Identities 2025](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-to-use-vm-token)
- [Microsoft - Azure AD Identity Tokens - Aug 2019](https://docs.microsoft.com/en-us/azure/active-directory/develop/access-tokens)
- [Microsoft - Azure AD App Registration - May 2019](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- [Microsoft - OAuth Code Authorization flow - June 2019](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
- [Microsoft Identity Platform Protocols May 2019](https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-v2-protocols)
- [Atomic Red Team - T1528](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1528)
- [MITRE ATT&CK - T1528](https://attack.mitre.org/techniques/T1528)
