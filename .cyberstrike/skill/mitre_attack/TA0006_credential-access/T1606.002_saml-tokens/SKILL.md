---
name: "T1606.002_saml-tokens"
description: "An adversary may forge SAML tokens with any permissions claims and lifetimes if they possess a valid SAML token-signing certificate."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1606.002
  - credential-access
  - saas
  - windows
  - iaas
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1606.002"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - SaaS
  - Windows
  - IaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1606/002"
tech_stack:
  - saas
  - windows
  - cloud
  - office
  - identity
cwe_ids:
  - CWE-522
chains_with:
  - T1606
  - T1606.001
prerequisites:
  - T1606
severity_boost:
  T1606: "Chain with T1606 for deeper attack path"
  T1606.001: "Chain with T1606.001 for deeper attack path"
---

# T1606.002 SAML Tokens

> **Sub-technique of:** T1606

## High-Level Description

An adversary may forge SAML tokens with any permissions claims and lifetimes if they possess a valid SAML token-signing certificate. The default lifetime of a SAML token is one hour, but the validity period can be specified in the <code>NotOnOrAfter</code> value of the <code>conditions ...</code> element in a token. This value can be changed using the <code>AccessTokenLifetime</code> in a <code>LifetimeTokenPolicy</code>. Forged SAML tokens enable adversaries to authenticate across services that use SAML 2.0 as an SSO (single sign-on) mechanism.

An adversary may utilize Private Keys to compromise an organization's token-signing certificate to create forged SAML tokens. If the adversary has sufficient permissions to establish a new federation trust with their own Active Directory Federation Services (AD FS) server, they may instead generate their own trusted token-signing certificate. This differs from Steal Application Access Token and other similar behaviors in that the tokens are new and forged by the adversary, rather than stolen or intercepted from legitimate users.

An adversary may gain administrative Entra ID privileges if a SAML token is forged which claims to represent a highly privileged account. This may lead to Use Alternate Authentication Material, which may bypass multi-factor and other authentication protection mechanisms.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** SaaS, Windows, IaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if SAML Tokens technique is applicable to target environment
- [ ] Check SaaS systems for indicators of SAML Tokens
- [ ] Check Windows systems for indicators of SAML Tokens
- [ ] Check IaaS systems for indicators of SAML Tokens
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SAML Tokens by examining the target platforms (SaaS, Windows, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1606.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1015 Active Directory Configuration
For containing the impact of a previously forged SAML token, rotate the token-signing AD FS certificate in rapid succession twice, which will invalidate any tokens generated using the previous certificate.

### M1047 Audit
Enable advanced auditing on AD FS. Check the success and failure audit options in the AD FS Management snap-in. Enable Audit Application Generated events on the AD FS farm via Group Policy Object.

### M1018 User Account Management
Ensure that user accounts with administrative rights follow best practices, including use of privileged access workstations, Just in Time/Just Enough Administration (JIT/JEA), and strong authentication. Reduce the number of users that are members of highly privileged Directory Roles.

### M1026 Privileged Account Management
Restrict permissions and access to the AD FS server to only originate from privileged access workstations.


## Detection

### Detection Strategy for Forged SAML Tokens


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| SAML Tokens technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Microsoft SolarWinds Steps](https://blogs.microsoft.com/on-the-issues/2020/12/13/customers-protect-nation-state-cyberattacks/)
- [Microsoft SAML Token Lifetimes](https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-configurable-token-lifetimes)
- [Microsoft SolarWinds Customer Guidance](https://msrc-blog.microsoft.com/2020/12/13/customer-guidance-on-recent-nation-state-cyber-attacks/)
- [Cyberark Golden SAML](https://www.cyberark.com/resources/threat-research-blog/golden-saml-newly-discovered-attack-technique-forges-authentication-to-cloud-apps)
- [Sygnia Golden SAML](https://www.sygnia.co/threat-reports-and-advisories/golden-saml-attack/)
- [Atomic Red Team - T1606.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1606.002)
- [MITRE ATT&CK - T1606.002](https://attack.mitre.org/techniques/T1606/002)
