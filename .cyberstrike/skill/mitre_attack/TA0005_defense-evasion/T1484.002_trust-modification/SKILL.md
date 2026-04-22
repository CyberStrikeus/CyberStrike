---
name: "T1484.002_trust-modification"
description: "Adversaries may add new domain trusts, modify the properties of existing domain trusts, or otherwise change the configuration of trust relationships between domains and tenants to evade defenses an..."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1484.002
  - defense-evasion
  - privilege-escalation
  - identity-provider
  - windows
  - sub-technique
technique_id: "T1484.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Identity Provider
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1484/002"
tech_stack:
  - identity
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1484
  - T1484.001
prerequisites:
  - T1484
severity_boost:
  T1484: "Chain with T1484 for deeper attack path"
  T1484.001: "Chain with T1484.001 for deeper attack path"
---

# T1484.002 Trust Modification

> **Sub-technique of:** T1484

## High-Level Description

Adversaries may add new domain trusts, modify the properties of existing domain trusts, or otherwise change the configuration of trust relationships between domains and tenants to evade defenses and/or elevate privileges.Trust details, such as whether or not user identities are federated, allow authentication and authorization properties to apply between domains or tenants for the purpose of accessing shared resources. These trust objects may include accounts, credentials, and other authentication material applied to servers, tokens, and domains.

Manipulating these trusts may allow an adversary to escalate privileges and/or evade defenses by modifying settings to add objects which they control. For example, in Microsoft Active Directory (AD) environments, this may be used to forge SAML Tokens without the need to compromise the signing certificate to forge new credentials. Instead, an adversary can manipulate domain trusts to add their own signing certificate. An adversary may also convert an AD domain to a federated domain using Active Directory Federation Services (AD FS), which may enable malicious trust modifications such as altering the claim issuance rules to log in any valid set of credentials as a specified user.

An adversary may also add a new federated identity provider to an identity tenant such as Okta or AWS IAM Identity Center, which may enable the adversary to authenticate as any user of the tenant. This may enable the threat actor to gain broad access into a variety of cloud-based services that leverage the identity tenant. For example, in AWS environments, an adversary that creates a new identity provider for an AWS Organization will be able to federate into all of the AWS Organization member accounts without creating identities for each of the member accounts.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Identity Provider, Windows

## What to Check

- [ ] Identify if Trust Modification technique is applicable to target environment
- [ ] Check Identity Provider systems for indicators of Trust Modification
- [ ] Check Windows systems for indicators of Trust Modification
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Trust Modification by examining the target platforms (Identity Provider, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1484.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Use the principal of least privilege and protect administrative access to domain trusts and identity tenants.

### M1018 User Account Management

In cloud environments, limit permissions to create new identity providers to only those accounts that require them. In AWS environments, consider using Service Control policies to limit the use of API calls such as `CreateSAMLProvider` or `CreateOpenIDConnectProvider`.

## Detection

### Detection of Trust Relationship Modifications in Domain or Tenant Policies

## Risk Assessment

| Finding                                 | Severity | Impact          |
| --------------------------------------- | -------- | --------------- |
| Trust Modification technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [AWS RE:Inforce Threat Detection 2024](https://reinforce.awsevents.com/content/dam/reinforce/2024/slides/TDR432_New-tactics-and-techniques-for-proactive-threat-detection.pdf)
- [CISA SolarWinds Cloud Detection](https://us-cert.cisa.gov/ncas/alerts/aa21-008a)
- [AADInternals zure AD Federated Domain](https://o365blog.com/post/federation-vulnerability/)
- [Microsoft - Azure AD Federation](https://docs.microsoft.com/en-us/azure/active-directory/hybrid/whatis-fed)
- [Microsoft - Azure Sentinel ADFSDomainTrustMods](https://github.com/Azure/Azure-Sentinel/blob/master/Detections/AuditLogs/ADFSDomainTrustMods.yaml)
- [Microsoft - Update or Repair Federated domain](https://docs.microsoft.com/en-us/office365/troubleshoot/active-directory/update-federated-domain-office-365)
- [Okta Cross-Tenant Impersonation 2023](https://sec.okta.com/articles/2023/08/cross-tenant-impersonation-prevention-and-detection)
- [Sygnia Golden SAML](https://www.sygnia.co/threat-reports-and-advisories/golden-saml-attack/)
- [Atomic Red Team - T1484.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1484.002)
- [MITRE ATT&CK - T1484.002](https://attack.mitre.org/techniques/T1484/002)
