---
name: "T1078.001_default-accounts"
description: "Adversaries may obtain and abuse credentials of a default account as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1078.001
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
  - windows
  - saas
  - iaas
  - linux
  - macos
  - containers
  - network-devices
  - office-suite
  - identity-provider
  - esxi
  - sub-technique
technique_id: "T1078.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
platforms:
  - Windows
  - SaaS
  - IaaS
  - Linux
  - macOS
  - Containers
  - Network Devices
  - Office Suite
  - Identity Provider
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1078/001"
tech_stack:
  - windows
  - saas
  - cloud
  - linux
  - macos
  - containers
  - network devices
  - office
  - identity
  - esxi
cwe_ids:
  - CWE-693
chains_with:
  - T1078
  - T1078.002
  - T1078.003
  - T1078.004
prerequisites:
  - T1078
severity_boost:
  T1078: "Chain with T1078 for deeper attack path"
  T1078.002: "Chain with T1078.002 for deeper attack path"
  T1078.003: "Chain with T1078.003 for deeper attack path"
---

# T1078.001 Default Accounts

> **Sub-technique of:** T1078

## High-Level Description

Adversaries may obtain and abuse credentials of a default account as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion. Default accounts are those that are built-into an OS, such as the Guest or Administrator accounts on Windows systems. Default accounts also include default factory/provider set accounts on other types of systems, software, or devices, including the root user account in AWS, the root user account in ESXi, and the default service account in Kubernetes.

Default accounts are not limited to client machines; rather, they also include accounts that are preset for equipment such as network devices and computer applications, whether they are internal, open source, or commercial. Appliances that come preset with a username and password combination pose a serious threat to organizations that do not change it post installation, as they are easy targets for an adversary. Similarly, adversaries may also utilize publicly disclosed or stolen Private Keys or credential materials to legitimately connect to remote environments via Remote Services.

Default accounts may be created on a system after initial setup by connecting or integrating it with another application. For example, when an ESXi server is connected to a vCenter server, a default privileged account called `vpxuser` is created on the ESXi server. If a threat actor is able to compromise this account’s credentials (for example, via Exploitation for Credential Access on the vCenter host), they will then have access to the ESXi server.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Initial Access (TA0001)

**Platforms:** Windows, SaaS, IaaS, Linux, macOS, Containers, Network Devices, Office Suite, Identity Provider, ESXi

## What to Check

- [ ] Identify if Default Accounts technique is applicable to target environment
- [ ] Check Windows systems for indicators of Default Accounts
- [ ] Check SaaS systems for indicators of Default Accounts
- [ ] Check IaaS systems for indicators of Default Accounts
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Enable Guest account with RDP capability and admin privileges

After execution the Default Guest account will be enabled (Active) and added to Administrators and Remote Desktop Users Group,
and desktop will allow multiple RDP connections.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
net user #{guest_user} /active:yes
net user #{guest_user} #{guest_password}
net localgroup #{local_admin_group} #{guest_user} /add
net localgroup "#{remote_desktop_users_group_name}" #{guest_user} /add
reg add "hklm\system\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f
reg add "hklm\system\CurrentControlSet\Control\Terminal Server" /v "AllowTSConnections" /t REG_DWORD /d 0x1 /f
```

### Atomic Test 2: Activate Guest Account

The Adversaries can activate the default Guest user. The guest account is inactivated by default

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
net user #{guest_user} /active:yes
```

### Atomic Test 3: Enable Guest Account on macOS

This test enables the guest account on macOS using sysadminctl utility.

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo sysadminctl -guestAccount on
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Default Accounts by examining the target platforms (Windows, SaaS, IaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1078.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1032 Multi-factor Authentication
Implement multi-factor authentication (MFA) for default accounts whenever possible to prevent unauthorized access, even if credentials for these accounts are compromised. MFA adds an additional layer of security that requires more than just a username and password, making it significantly harder for adversaries to exploit these accounts for initial access or lateral movement.

### M1027 Password Policies
Applications and appliances that utilize default username and password should be changed immediately after the installation, and before deployment to a production environment.


## Detection

### Detection of Default Account Abuse Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Default Accounts technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Google Cloud Threat Intelligence VMWare ESXi Zero-Day 2023](https://cloud.google.com/blog/topics/threat-intelligence/vmware-esxi-zero-day-bypass/)
- [AWS Root User](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html)
- [Microsoft Local Accounts Feb 2019](https://docs.microsoft.com/en-us/windows/security/identity-protection/access-control/local-accounts)
- [Metasploit SSH Module](https://github.com/rapid7/metasploit-framework/tree/master/modules/exploits/linux/ssh)
- [Threat Matrix for Kubernetes](https://www.microsoft.com/security/blog/2020/04/02/attack-matrix-kubernetes/)
- [Pentera vCenter Information Disclosure](https://pentera.io/blog/information-disclosure-in-vmware-vcenter/)
- [Atomic Red Team - T1078.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1078.001)
- [MITRE ATT&CK - T1078.001](https://attack.mitre.org/techniques/T1078/001)
