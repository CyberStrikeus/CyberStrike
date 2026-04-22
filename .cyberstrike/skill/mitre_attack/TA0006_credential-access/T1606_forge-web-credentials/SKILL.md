---
name: "T1606_forge-web-credentials"
description: "Adversaries may forge credential materials that can be used to gain access to web applications or Internet services."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1606
  - credential-access
  - saas
  - windows
  - macos
  - linux
  - iaas
  - office-suite
  - identity-provider
technique_id: "T1606"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - SaaS
  - Windows
  - macOS
  - Linux
  - IaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1606"
tech_stack:
  - saas
  - windows
  - macos
  - linux
  - cloud
  - office
  - identity
cwe_ids:
  - CWE-522
chains_with:
  - T1606.001
  - T1606.002
prerequisites: []
severity_boost:
  T1606.001: "Chain with T1606.001 for deeper attack path"
  T1606.002: "Chain with T1606.002 for deeper attack path"
---

# T1606 Forge Web Credentials

## High-Level Description

Adversaries may forge credential materials that can be used to gain access to web applications or Internet services. Web applications and services (hosted in cloud SaaS environments or on-premise servers) often use session cookies, tokens, or other materials to authenticate and authorize user access.

Adversaries may generate these credential materials in order to gain access to web resources. This differs from Steal Web Session Cookie, Steal Application Access Token, and other similar behaviors in that the credentials are new and forged by the adversary, rather than stolen or intercepted from legitimate users.

The generation of web credentials often requires secret values, such as passwords, Private Keys, or other cryptographic seed values. Adversaries may also forge tokens by taking advantage of features such as the `AssumeRole` and `GetFederationToken` APIs in AWS, which allow users to request temporary security credentials (i.e., Temporary Elevated Cloud Access), or the `zmprov gdpak` command in Zimbra, which generates a pre-authentication key that can be used to generate tokens for any user in the domain.

Once forged, adversaries may use these web credentials to access resources (ex: Use Alternate Authentication Material), which may bypass multi-factor and other authentication protection mechanisms.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** SaaS, Windows, macOS, Linux, IaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Forge Web Credentials technique is applicable to target environment
- [ ] Check SaaS systems for indicators of Forge Web Credentials
- [ ] Check Windows systems for indicators of Forge Web Credentials
- [ ] Check macOS systems for indicators of Forge Web Credentials
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Forge Web Credentials by examining the target platforms (SaaS, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1606 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Restrict permissions and access to the AD FS server to only originate from privileged access workstations.

### M1054 Software Configuration

Configure browsers/applications to regularly delete persistent web credentials (such as cookies).

### M1047 Audit

Administrators should perform an audit of all access lists and the permissions they have been granted to access web applications and services. This should be done extensively on all resources in order to establish a baseline, followed up on with periodic audits of new or updated resources. Suspicious accounts/credentials should be investigated and removed.

Enable advanced auditing on ADFS. Check the success and failure audit options in the ADFS Management snap-in. Enable Audit Application Generated events on the AD FS farm via Group Policy Object.

### M1018 User Account Management

Ensure that user accounts with administrative rights follow best practices, including use of privileged access workstations, Just in Time/Just Enough Administration (JIT/JEA), and strong authentication. Reduce the number of users that are members of highly privileged Directory Roles. In AWS environments, prohibit users from calling the `sts:GetFederationToken` API unless explicitly required.

## Detection

### Detection Strategy for Forged Web Credentials

## Risk Assessment

| Finding                                    | Severity | Impact            |
| ------------------------------------------ | -------- | ----------------- |
| Forge Web Credentials technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [AWS Temporary Security Credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_request.html)
- [Unit 42 Mac Crypto Cookies January 2019](https://unit42.paloaltonetworks.com/mac-malware-steals-cryptocurrency-exchanges-cookies/)
- [GitHub AWS-ADFS-Credential-Generator](https://github.com/pvanbuijtene/aws-adfs-credential-generator)
- [Microsoft SolarWinds Customer Guidance](https://msrc-blog.microsoft.com/2020/12/13/customer-guidance-on-recent-nation-state-cyber-attacks/)
- [Pass The Cookie](https://wunderwuzzi23.github.io/blog/passthecookie.html)
- [Zimbra Preauth](https://wiki.zimbra.com/wiki/Preauth)
- [Atomic Red Team - T1606](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1606)
- [MITRE ATT&CK - T1606](https://attack.mitre.org/techniques/T1606)
