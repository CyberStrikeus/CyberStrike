---
name: "T1556_modify-authentication-process"
description: "Adversaries may modify authentication mechanisms and processes to access user credentials or enable otherwise unwarranted access to accounts."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556
  - credential-access
  - defense-evasion
  - persistence
  - windows
  - linux
  - macos
  - network-devices
  - iaas
  - saas
  - office-suite
  - identity-provider
technique_id: "T1556"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Windows
  - Linux
  - macOS
  - Network Devices
  - IaaS
  - SaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1556"
tech_stack:
  - windows
  - linux
  - macos
  - network devices
  - cloud
  - saas
  - office
  - identity
cwe_ids:
  - CWE-522
chains_with:
  - T1556.001
  - T1556.002
  - T1556.003
  - T1556.004
  - T1556.005
  - T1556.006
  - T1556.007
  - T1556.008
  - T1556.009
prerequisites: []
severity_boost:
  T1556.001: "Chain with T1556.001 for deeper attack path"
  T1556.002: "Chain with T1556.002 for deeper attack path"
  T1556.003: "Chain with T1556.003 for deeper attack path"
---

# T1556 Modify Authentication Process

## High-Level Description

Adversaries may modify authentication mechanisms and processes to access user credentials or enable otherwise unwarranted access to accounts. The authentication process is handled by mechanisms, such as the Local Security Authentication Server (LSASS) process and the Security Accounts Manager (SAM) on Windows, pluggable authentication modules (PAM) on Unix-based systems, and authorization plugins on MacOS systems, responsible for gathering, storing, and validating credentials. By modifying an authentication process, an adversary may be able to authenticate to a service or system without using Valid Accounts.

Adversaries may maliciously modify a part of this process to either reveal credentials or bypass authentication mechanisms. Compromised credentials or access may be used to bypass access controls placed on various resources on systems within the network and may even be used for persistent access to remote systems and externally available services, such as VPNs, Outlook Web Access and remote desktop.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows, Linux, macOS, Network Devices, IaaS, SaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Modify Authentication Process technique is applicable to target environment
- [ ] Check Windows systems for indicators of Modify Authentication Process
- [ ] Check Linux systems for indicators of Modify Authentication Process
- [ ] Check macOS systems for indicators of Modify Authentication Process
- [ ] Verify mitigations are bypassed or absent (9 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Modify Authentication Process by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1556 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1024 Restrict Registry Permissions

Restrict Registry permissions to disallow the modification of sensitive Registry keys such as `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\NetworkProvider\Order`.

### M1032 Multi-factor Authentication

Integrating multi-factor authentication (MFA) as part of organizational policy can greatly reduce the risk of an adversary gaining control of valid credentials that may be used for additional tactics such as initial access, lateral movement, and collecting information. MFA can also be used to restrict access to cloud resources and APIs.

### M1027 Password Policies

Ensure that <code>AllowReversiblePasswordEncryption</code> property is set to disabled unless there are application requirements.

### M1022 Restrict File and Directory Permissions

Restrict write access to the `/Library/Security/SecurityAgentPlugins` directory.

### M1018 User Account Management

Ensure that proper policies are implemented to dictate the the secure enrollment and deactivation of authentication mechanisms, such as MFA, for user accounts.

### M1026 Privileged Account Management

Audit domain and local accounts as well as their permission levels routinely to look for situations that could allow an adversary to gain wide access by obtaining credentials of a privileged account. These audits should also include if default accounts have been enabled, or if new local accounts are created that have not be authorized. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

Limit access to the root account and prevent users from modifying protected components through proper privilege separation (ex SELinux, grsecurity, AppArmor, etc.) and limiting Privilege Escalation opportunities.

Limit on-premises accounts with access to the hybrid identity solution in place. For example, limit Azure AD Global Administrator accounts to only those required, and ensure that these are dedicated cloud-only accounts rather than hybrid ones.

### M1025 Privileged Process Integrity

Enabled features, such as Protected Process Light (PPL), for LSA.

### M1047 Audit

Review authentication logs to ensure that mechanisms such as enforcement of MFA are functioning as intended.

Periodically review the hybrid identity solution in use for any discrepancies. For example, review all Pass Through Authentication (PTA) agents in the Azure Management Portal to identify any unwanted or unapproved ones. If ADFS is in use, review DLLs and executable files in the AD FS and Global Assembly Cache directories to ensure that they are signed by Microsoft. Note that in some cases binaries may be catalog-signed, which may cause the file to appear unsigned when viewing file properties.

Periodically review for new and unknown network provider DLLs within the Registry (`HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\<NetworkProviderName>\NetworkProvider\ProviderPath`). Ensure only valid network provider DLLs are registered. The name of these can be found in the Registry key at `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\NetworkProvider\Order`, and have corresponding service subkey pointing to a DLL at `HKEY_LOCAL_MACHINE\SYSTEM\CurrentC ontrolSet\Services\<NetworkProviderName>\NetworkProvider`.

### M1028 Operating System Configuration

Ensure only valid password filters are registered. Filter DLLs must be present in Windows installation directory (`C:\Windows\System32\` by default) of a domain controller and/or local computer with a corresponding entry in `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Lsa\Notification Packages`.

Starting in Windows 11 22H2, the `EnableMPRNotifications` policy can be disabled through Group Policy or through a configuration service provider to prevent Winlogon from sending credentials to network providers.

## Detection

### Detect Modification of Authentication Processes Across Platforms

## Risk Assessment

| Finding                                            | Severity | Impact            |
| -------------------------------------------------- | -------- | ----------------- |
| Modify Authentication Process technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Clymb3r Function Hook Passwords Sept 2013](https://clymb3r.wordpress.com/2013/09/15/intercepting-password-changes-with-function-hooking/)
- [Xorrior Authorization Plugins](https://xorrior.com/persistent-credential-theft/)
- [Dell Skeleton](https://www.secureworks.com/research/skeleton-key-malware-analysis)
- [dump_pwd_dcsync](https://adsecurity.org/?p=2053)
- [TechNet Audit Policy](https://technet.microsoft.com/en-us/library/dn487457.aspx)
- [Atomic Red Team - T1556](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556)
- [MITRE ATT&CK - T1556](https://attack.mitre.org/techniques/T1556)
