---
name: "T1078_valid-accounts"
description: "Adversaries may obtain and abuse credentials of existing accounts as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1078
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
  - containers
  - esxi
  - iaas
  - identity-provider
  - linux
  - macos
  - network-devices
  - office-suite
  - saas
  - windows
technique_id: "T1078"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
platforms:
  - Containers
  - ESXi
  - IaaS
  - Identity Provider
  - Linux
  - macOS
  - Network Devices
  - Office Suite
  - SaaS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1078"
tech_stack:
  - containers
  - esxi
  - cloud
  - identity
  - linux
  - macos
  - network devices
  - office
  - saas
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1078.001
  - T1078.002
  - T1078.003
  - T1078.004
prerequisites: []
severity_boost:
  T1078.001: "Chain with T1078.001 for deeper attack path"
  T1078.002: "Chain with T1078.002 for deeper attack path"
  T1078.003: "Chain with T1078.003 for deeper attack path"
---

# T1078 Valid Accounts

## High-Level Description

Adversaries may obtain and abuse credentials of existing accounts as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion. Compromised credentials may be used to bypass access controls placed on various resources on systems within the network and may even be used for persistent access to remote systems and externally available services, such as VPNs, Outlook Web Access, network devices, and remote desktop. Compromised credentials may also grant an adversary increased privilege to specific systems or access to restricted areas of the network. Adversaries may choose not to use malware or tools in conjunction with the legitimate access those credentials provide to make it harder to detect their presence.

In some cases, adversaries may abuse inactive accounts: for example, those belonging to individuals who are no longer part of an organization. Using these accounts may allow the adversary to evade detection, as the original account user will not be present to identify any anomalous activity taking place on their account.

The overlap of permissions for local, domain, and cloud accounts across a network of systems is of concern because the adversary may be able to pivot across accounts and systems to reach a high level of access (i.e., domain or enterprise administrator) to bypass access controls set within the enterprise.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Initial Access (TA0001)

**Platforms:** Containers, ESXi, IaaS, Identity Provider, Linux, macOS, Network Devices, Office Suite, SaaS, Windows

## What to Check

- [ ] Identify if Valid Accounts technique is applicable to target environment
- [ ] Check Containers systems for indicators of Valid Accounts
- [ ] Check ESXi systems for indicators of Valid Accounts
- [ ] Check IaaS systems for indicators of Valid Accounts
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Valid Accounts by examining the target platforms (Containers, ESXi, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1078 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1027 Password Policies

Applications and appliances that utilize default username and password should be changed immediately after the installation, and before deployment to a production environment. When possible, applications that use SSH keys should be updated periodically and properly secured.

Policies should minimize (if not eliminate) reuse of passwords between different user accounts, especially employees using the same credentials for personal accounts that may not be defended by enterprise security resources.

### M1018 User Account Management

Regularly audit user accounts for activity and deactivate or remove any that are no longer needed.

### M1026 Privileged Account Management

Audit domain and local accounts as well as their permission levels routinely to look for situations that could allow an adversary to gain wide access by obtaining credentials of a privileged account. These audits should also include if default accounts have been enabled, or if new local accounts are created that have not been authorized. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

### M1032 Multi-factor Authentication

Implement multi-factor authentication (MFA) across all account types, including default, local, domain, and cloud accounts, to prevent unauthorized access, even if credentials are compromised. MFA provides a critical layer of security by requiring multiple forms of verification beyond just a password. This measure significantly reduces the risk of adversaries abusing valid accounts to gain initial access, escalate privileges, maintain persistence, or evade defenses within your network.

### M1013 Application Developer Guidance

Ensure that applications do not store sensitive data or credentials insecurely. (e.g. plaintext credentials in code, published credentials in repositories, or credentials in public cloud storage).

### M1017 User Training

Applications may send push notifications to verify a login as a form of multi-factor authentication (MFA). Train users to only accept valid push notifications and to report suspicious push notifications.

### M1015 Active Directory Configuration

Disable legacy authentication, which does not support MFA, and require the use of modern authentication protocols instead.

### M1036 Account Use Policies

Use conditional access policies to block logins from non-compliant devices or from outside defined organization IP ranges.

## Detection

### Detection of Valid Account Abuse Across Platforms

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| Valid Accounts technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [volexity_0day_sophos_FW](https://www.volexity.com/blog/2022/06/15/driftingcloud-zero-day-sophos-firewall-exploitation-and-an-insidious-breach/)
- [CISA MFA PrintNightmare](https://www.cisa.gov/uscert/ncas/alerts/aa22-074a)
- [TechNet Credential Theft](https://technet.microsoft.com/en-us/library/dn535501.aspx)
- [TechNet Audit Policy](https://technet.microsoft.com/en-us/library/dn487457.aspx)
- [Atomic Red Team - T1078](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1078)
- [MITRE ATT&CK - T1078](https://attack.mitre.org/techniques/T1078)
