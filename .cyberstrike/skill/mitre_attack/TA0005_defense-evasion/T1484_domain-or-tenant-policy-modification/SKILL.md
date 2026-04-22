---
name: "T1484_domain-or-tenant-policy-modification"
description: "Adversaries may modify the configuration settings of a domain or identity tenant to evade defenses and/or escalate privileges in centrally managed environments."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1484
  - defense-evasion
  - privilege-escalation
  - windows
  - identity-provider
technique_id: "T1484"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1484"
tech_stack:
  - windows
  - identity
cwe_ids:
  - CWE-693
chains_with:
  - T1484.001
  - T1484.002
prerequisites: []
severity_boost:
  T1484.001: "Chain with T1484.001 for deeper attack path"
  T1484.002: "Chain with T1484.002 for deeper attack path"
---

# T1484 Domain or Tenant Policy Modification

## High-Level Description

Adversaries may modify the configuration settings of a domain or identity tenant to evade defenses and/or escalate privileges in centrally managed environments. Such services provide a centralized means of managing identity resources such as devices and accounts, and often include configuration settings that may apply between domains or tenants such as trust relationships, identity syncing, or identity federation.

Modifications to domain or tenant settings may include altering domain Group Policy Objects (GPOs) in Microsoft Active Directory (AD) or changing trust settings for domains, including federation trusts relationships between domains or tenants.

With sufficient permissions, adversaries can modify domain or tenant policy settings. Since configuration settings for these services apply to a large number of identity resources, there are a great number of potential attacks malicious outcomes that can stem from this abuse. Examples of such abuse include:

- modifying GPOs to push a malicious Scheduled Task to computers throughout the domain environment
- modifying domain trusts to include an adversary-controlled domain, allowing adversaries to forge access tokens that will subsequently be accepted by victim domain resources
- changing configuration settings within the AD environment to implement a Rogue Domain Controller.
- adding new, adversary-controlled federated identity providers to identity tenants, allowing adversaries to authenticate as any user managed by the victim tenant

Adversaries may temporarily modify domain or tenant policy, carry out a malicious action(s), and then revert the change to remove suspicious indicators.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows, Identity Provider

## What to Check

- [ ] Identify if Domain or Tenant Policy Modification technique is applicable to target environment
- [ ] Check Windows systems for indicators of Domain or Tenant Policy Modification
- [ ] Check Identity Provider systems for indicators of Domain or Tenant Policy Modification
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain or Tenant Policy Modification by examining the target platforms (Windows, Identity Provider).

2. **Assess Existing Defenses**: Review whether mitigations for T1484 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Identify and correct GPO permissions abuse opportunities (ex: GPO modification privileges) using auditing tools such as BloodHound (version 1.5.1 and later).

### M1026 Privileged Account Management

Use least privilege and protect administrative access to the Domain Controller and Active Directory Federation Services (AD FS) server. Do not create service accounts with administrative privileges.

### M1018 User Account Management

Consider implementing WMI and security filtering to further tailor which users and computers a GPO will apply to.

## Detection

### Detection of Domain or Tenant Policy Modifications via AD and Identity Provider

## Risk Assessment

| Finding                                                   | Severity | Impact          |
| --------------------------------------------------------- | -------- | --------------- |
| Domain or Tenant Policy Modification technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [CISA SolarWinds Cloud Detection](https://us-cert.cisa.gov/ncas/alerts/aa21-008a)
- [ADSecurity GPO Persistence 2016](https://adsecurity.org/?p=2716)
- [Microsoft 365 Defender Solorigate](https://www.microsoft.com/security/blog/2020/12/28/using-microsoft-365-defender-to-coordinate-protection-against-solorigate/)
- [Microsoft - Azure Sentinel ADFSDomainTrustMods](https://github.com/Azure/Azure-Sentinel/blob/master/Detections/AuditLogs/ADFSDomainTrustMods.yaml)
- [Microsoft - Update or Repair Federated domain](https://docs.microsoft.com/en-us/office365/troubleshoot/active-directory/update-federated-domain-office-365)
- [Microsoft - Customer Guidance on Recent Nation-State Cyber Attacks](https://msrc-blog.microsoft.com/2020/12/13/customer-guidance-on-recent-nation-state-cyber-attacks/)
- [Okta Cross-Tenant Impersonation 2023](https://sec.okta.com/articles/2023/08/cross-tenant-impersonation-prevention-and-detection)
- [Wald0 Guide to GPOs](https://wald0.com/?p=179)
- [Harmj0y Abusing GPO Permissions](https://blog.harmj0y.net/redteaming/abusing-gpo-permissions/)
- [Sygnia Golden SAML](https://www.sygnia.co/threat-reports-and-advisories/golden-saml-attack/)
- [Atomic Red Team - T1484](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1484)
- [MITRE ATT&CK - T1484](https://attack.mitre.org/techniques/T1484)
