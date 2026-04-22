---
name: "T1078.002_domain-accounts"
description: "Adversaries may obtain and abuse credentials of a domain account as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1078.002
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1078.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1078/002"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1078
  - T1078.001
  - T1078.003
  - T1078.004
prerequisites:
  - T1078
severity_boost:
  T1078: "Chain with T1078 for deeper attack path"
  T1078.001: "Chain with T1078.001 for deeper attack path"
  T1078.003: "Chain with T1078.003 for deeper attack path"
---

# T1078.002 Domain Accounts

> **Sub-technique of:** T1078

## High-Level Description

Adversaries may obtain and abuse credentials of a domain account as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion. Domain accounts are those managed by Active Directory Domain Services where access and permissions are configured across systems and services that are part of that domain. Domain accounts can cover users, administrators, and services.

Adversaries may compromise domain accounts, some with a high level of privileges, through various means such as OS Credential Dumping or password reuse, allowing access to privileged resources of the domain.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Initial Access (TA0001)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Domain Accounts technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Domain Accounts
- [ ] Check Linux systems for indicators of Domain Accounts
- [ ] Check macOS systems for indicators of Domain Accounts
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Domain Accounts by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1078.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Regularly review and manage domain accounts to ensure that only active, necessary accounts exist. Remove or disable inactive and unnecessary accounts to reduce the risk of adversaries abusing these accounts to gain unauthorized access or move laterally within the network.

### M1032 Multi-factor Authentication

Integrating multi-factor authentication (MFA) as part of organizational policy can greatly reduce the risk of an adversary gaining control of valid credentials that may be used for additional tactics such as initial access, lateral movement, and collecting information. MFA can also be used to restrict access to cloud resources and APIs.

### M1026 Privileged Account Management

Audit domain account permission levels routinely to look for situations that could allow an adversary to gain wide access by obtaining credentials of a privileged account. Do not put user or admin domain accounts in the local administrator groups across systems unless they are tightly controlled and use of accounts is segmented, as this is often equivalent to having a local administrator account with the same password on all systems. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers. Limit credential overlap across systems to prevent access if account credentials are obtained.

### M1017 User Training

Applications may send push notifications to verify a login as a form of multi-factor authentication (MFA). Train users to only accept valid push notifications and to report suspicious push notifications.

### M1027 Password Policies

Implement and enforce strong password policies for domain accounts to ensure passwords are complex, unique, and regularly rotated. This reduces the likelihood of password guessing, credential stuffing, and other attack methods that rely on weak or static credentials.

## Detection

### Abuse of Domain Accounts

## Risk Assessment

| Finding                              | Severity | Impact          |
| ------------------------------------ | -------- | --------------- |
| Domain Accounts technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [TechNet Credential Theft](https://technet.microsoft.com/en-us/library/dn535501.aspx)
- [TechNet Audit Policy](https://technet.microsoft.com/en-us/library/dn487457.aspx)
- [Microsoft AD Accounts](https://docs.microsoft.com/en-us/windows/security/identity-protection/access-control/active-directory-accounts)
- [Ubuntu SSSD Docs](https://ubuntu.com/server/docs/service-sssd)
- [Atomic Red Team - T1078.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1078.002)
- [MITRE ATT&CK - T1078.002](https://attack.mitre.org/techniques/T1078/002)
