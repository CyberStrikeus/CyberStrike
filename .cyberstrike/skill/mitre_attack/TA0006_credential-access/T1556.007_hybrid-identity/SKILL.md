---
name: "T1556.007_hybrid-identity"
description: "Adversaries may patch, modify, or otherwise backdoor cloud authentication processes that are tied to on-premises user identities in order to bypass typical authentication mechanisms, access credent..."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.007
  - credential-access
  - defense-evasion
  - persistence
  - windows
  - saas
  - iaas
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1556.007"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Windows
  - SaaS
  - IaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1556/007"
tech_stack:
  - windows
  - saas
  - cloud
  - office
  - identity
cwe_ids:
  - CWE-522
chains_with:
  - T1556
  - T1556.001
  - T1556.002
  - T1556.003
  - T1556.004
  - T1556.005
  - T1556.006
  - T1556.008
  - T1556.009
prerequisites:
  - T1556
severity_boost:
  T1556: "Chain with T1556 for deeper attack path"
  T1556.001: "Chain with T1556.001 for deeper attack path"
  T1556.002: "Chain with T1556.002 for deeper attack path"
---

# T1556.007 Hybrid Identity

> **Sub-technique of:** T1556

## High-Level Description

Adversaries may patch, modify, or otherwise backdoor cloud authentication processes that are tied to on-premises user identities in order to bypass typical authentication mechanisms, access credentials, and enable persistent access to accounts.

Many organizations maintain hybrid user and device identities that are shared between on-premises and cloud-based environments. These can be maintained in a number of ways. For example, Microsoft Entra ID includes three options for synchronizing identities between Active Directory and Entra ID:

- Password Hash Synchronization (PHS), in which a privileged on-premises account synchronizes user password hashes between Active Directory and Entra ID, allowing authentication to Entra ID to take place entirely in the cloud
- Pass Through Authentication (PTA), in which Entra ID authentication attempts are forwarded to an on-premises PTA agent, which validates the credentials against Active Directory
- Active Directory Federation Services (AD FS), in which a trust relationship is established between Active Directory and Entra ID

AD FS can also be used with other SaaS and cloud platforms such as AWS and GCP, which will hand off the authentication process to AD FS and receive a token containing the hybrid users’ identity and privileges.

By modifying authentication processes tied to hybrid identities, an adversary may be able to establish persistent privileged access to cloud resources. For example, adversaries who compromise an on-premises server running a PTA agent may inject a malicious DLL into the `AzureADConnectAuthenticationAgentService` process that authorizes all attempts to authenticate to Entra ID, as well as records user credentials. In environments using AD FS, an adversary may edit the `Microsoft.IdentityServer.Servicehost` configuration file to load a malicious DLL that generates authentication tokens for any user with any set of claims, thereby bypassing multi-factor authentication and defined AD FS policies.

In some cases, adversaries may be able to modify the hybrid identity authentication process from the cloud. For example, adversaries who compromise a Global Administrator account in an Entra ID tenant may be able to register a new PTA agent via the web console, similarly allowing them to harvest credentials and log into the Entra ID environment as any user.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows, SaaS, IaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Hybrid Identity technique is applicable to target environment
- [ ] Check Windows systems for indicators of Hybrid Identity
- [ ] Check SaaS systems for indicators of Hybrid Identity
- [ ] Check IaaS systems for indicators of Hybrid Identity
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hybrid Identity by examining the target platforms (Windows, SaaS, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication

Integrating multi-factor authentication (MFA) as part of organizational policy can greatly reduce the risk of an adversary gaining control of valid credentials that may be used for additional tactics such as initial access, lateral movement, and collecting information. MFA can also be used to restrict access to cloud resources and APIs.

### M1047 Audit

Periodically review the hybrid identity solution in use for any discrepancies. For example, review all PTA agents in the Entra ID Management Portal to identify any unwanted or unapproved ones. If ADFS is in use, review DLLs and executable files in the AD FS and Global Assembly Cache directories to ensure that they are signed by Microsoft. Note that in some cases binaries may be catalog-signed, which may cause the file to appear unsigned when viewing file properties.

### M1026 Privileged Account Management

Limit on-premises accounts with access to the hybrid identity solution in place. For example, limit Entra ID Global Administrator accounts to only those required, and ensure that these are dedicated cloud-only accounts rather than hybrid ones.

## Detection

### Detect Hybrid Identity Authentication Process Modification

## Risk Assessment

| Finding                              | Severity | Impact            |
| ------------------------------------ | -------- | ----------------- |
| Hybrid Identity technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Azure AD Connect for Read Teamers](https://blog.xpnsec.com/azuread-connect-for-redteam/)
- [AADInternals Azure AD On-Prem to Cloud](https://o365blog.com/post/on-prem_admin/)
- [MagicWeb](https://www.microsoft.com/security/blog/2022/08/24/magicweb-nobeliums-post-compromise-trick-to-authenticate-as-anyone/)
- [Azure AD Hybrid Identity](https://learn.microsoft.com/en-us/azure/active-directory/hybrid/choose-ad-authn)
- [Mandiant Azure AD Backdoors](https://www.mandiant.com/resources/detecting-microsoft-365-azure-active-directory-backdoors)
- [Atomic Red Team - T1556.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.007)
- [MITRE ATT&CK - T1556.007](https://attack.mitre.org/techniques/T1556/007)
