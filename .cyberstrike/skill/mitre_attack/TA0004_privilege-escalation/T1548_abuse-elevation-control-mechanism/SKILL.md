---
name: "T1548_abuse-elevation-control-mechanism"
description: "Adversaries may circumvent mechanisms designed to control elevate privileges to gain higher-level permissions."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1548
  - privilege-escalation
  - defense-evasion
  - linux
  - macos
  - windows
  - iaas
  - office-suite
  - identity-provider
technique_id: "T1548"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
  - IaaS
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1548"
tech_stack:
  - linux
  - macos
  - windows
  - cloud
  - office
  - identity
cwe_ids:
  - CWE-269
chains_with:
  - T1548.001
  - T1548.002
  - T1548.003
  - T1548.004
  - T1548.005
  - T1548.006
prerequisites:
  []
severity_boost:
  T1548.001: "Chain with T1548.001 for deeper attack path"
  T1548.002: "Chain with T1548.002 for deeper attack path"
  T1548.003: "Chain with T1548.003 for deeper attack path"
---

# T1548 Abuse Elevation Control Mechanism

## High-Level Description

Adversaries may circumvent mechanisms designed to control elevate privileges to gain higher-level permissions. Most modern systems contain native elevation control mechanisms that are intended to limit privileges that a user can perform on a machine. Authorization has to be granted to specific users in order to perform tasks that can be considered of higher risk. An adversary can perform several methods to take advantage of built-in control mechanisms in order to escalate privileges on a system.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows, IaaS, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Abuse Elevation Control Mechanism technique is applicable to target environment
- [ ] Check Linux systems for indicators of Abuse Elevation Control Mechanism
- [ ] Check macOS systems for indicators of Abuse Elevation Control Mechanism
- [ ] Check Windows systems for indicators of Abuse Elevation Control Mechanism
- [ ] Verify mitigations are bypassed or absent (8 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Abuse Elevation Control Mechanism by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1548 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention
System settings can prevent applications from running that haven't been downloaded from legitimate repositories which may help mitigate some of these issues. Not allowing unsigned applications from being run may also mitigate some risk.

### M1028 Operating System Configuration
Applications with known vulnerabilities or known shell escapes should not have the setuid or setgid bits set to reduce potential damage if an application is compromised. Additionally, the number of programs with setuid or setgid bits set should be minimized across a system. Ensuring that the sudo tty_tickets setting is enabled will prevent this leakage across tty sessions.

### M1051 Update Software
Perform regular software updates to mitigate exploitation risk.

### M1052 User Account Control
Although UAC bypass techniques exist, it is still prudent to use the highest enforcement level for UAC when possible and mitigate bypass opportunities that exist with techniques such as DLL.

### M1026 Privileged Account Management
Remove users from the local administrator group on systems.

By requiring a password, even if an adversary can get terminal access, they must know the password to run anything in the sudoers file. Setting the timestamp_timeout to 0 will require the user to input their password every time sudo is executed.

### M1018 User Account Management
Limit the privileges of cloud accounts to assume, create, or impersonate additional roles, policies, and permissions to only those required. Where just-in-time access is enabled, consider requiring manual approval for temporary elevation of privileges.

### M1047 Audit
Check for common UAC bypass weaknesses on Windows systems to be aware of the risk posture and address issues where appropriate.

### M1022 Restrict File and Directory Permissions
The sudoers file should be strictly edited such that passwords are always required and that users can't spawn risky processes as users with higher privilege.


## Detection

### Detection Strategy for Abuse Elevation Control Mechanism (T1548)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Abuse Elevation Control Mechanism technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [TechNet How UAC Works](https://technet.microsoft.com/en-us/itpro/windows/keep-secure/how-user-account-control-works)
- [OSX Keydnap malware](https://www.welivesecurity.com/2016/07/06/new-osxkeydnap-malware-hungry-credentials/)
- [Fortinet Fareit](https://blog.fortinet.com/2016/12/16/malicious-macro-bypasses-uac-to-elevate-privilege-for-fareit-malware)
- [sudo man page 2018](https://www.sudo.ws/)
- [Atomic Red Team - T1548](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1548)
- [MITRE ATT&CK - T1548](https://attack.mitre.org/techniques/T1548)
