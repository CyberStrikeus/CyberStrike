---
name: "T1136.001_local-account"
description: "Adversaries may create a local account to maintain access to victim systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1136.001
  - persistence
  - linux
  - macos
  - windows
  - network-devices
  - containers
  - esxi
  - sub-technique
technique_id: "T1136.001"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
  - Containers
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1136/001"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
  - containers
  - esxi
cwe_ids:
  - CWE-276
chains_with:
  - T1136
  - T1136.002
  - T1136.003
prerequisites:
  - T1136
severity_boost:
  T1136: "Chain with T1136 for deeper attack path"
  T1136.002: "Chain with T1136.002 for deeper attack path"
  T1136.003: "Chain with T1136.003 for deeper attack path"
---

# T1136.001 Local Account

> **Sub-technique of:** T1136

## High-Level Description

Adversaries may create a local account to maintain access to victim systems. Local accounts are those configured by an organization for use by users, remote support, services, or for administration on a single system or service.

For example, with a sufficient level of access, the Windows <code>net user /add</code> command can be used to create a local account. In Linux, the `useradd` command can be used, while on macOS systems, the <code>dscl -create</code> command can be used. Local accounts may also be added to network devices, often via common Network Device CLI commands such as <code>username</code>, to ESXi servers via `esxcli system account add`, or to Kubernetes clusters using the `kubectl` utility.

Adversaries may also create new local accounts on network firewall management consoles – for example, by exploiting a vulnerable firewall management system, threat actors may be able to establish super-admin accounts that could be used to modify firewall rules and gain further access to the network.

Such accounts may be used to establish secondary credentialed access that do not require persistent remote access tools to be deployed on the system.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, macOS, Windows, Network Devices, Containers, ESXi

## What to Check

- [ ] Identify if Local Account technique is applicable to target environment
- [ ] Check Linux systems for indicators of Local Account
- [ ] Check macOS systems for indicators of Local Account
- [ ] Check Windows systems for indicators of Local Account
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create a user account on a Linux system

Create a user via useradd

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
useradd -M -N -r -s /bin/bash -c evil_account #{username}
```

### Atomic Test 2: Create a user account on a FreeBSD system

Create a user via pw

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
pw useradd #{username} -s /usr/sbin/nologin -d /nonexistent -c evil_account
```

### Atomic Test 3: Create a user account on a MacOS system

Creates a user on a MacOS system with dscl

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
dscl . -create /Users/#{username}
dscl . -create /Users/#{username} UserShell /bin/zsh
dscl . -create /Users/#{username} RealName "#{realname}"
dscl . -create /Users/#{username} UniqueID "1010"
dscl . -create /Users/#{username} PrimaryGroupID 80
dscl . -create /Users/#{username} NFSHomeDirectory /Users/#{username}
```

### Atomic Test 4: Create a new user in a command prompt

Creates a new user in a command prompt. Upon execution, "The command completed successfully." will be displayed. To verify the
new account, run "net user" in powershell or CMD and observe that there is a new user named "T1136.001_CMD"

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
net user /add "#{username}" "#{password}"
```

### Atomic Test 5: Create a new user in PowerShell

Creates a new user in PowerShell. Upon execution, details about the new account will be displayed in the powershell session. To verify the
new account, run "net user" in powershell or CMD and observe that there is a new user named "T1136.001_PowerShell"

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-LocalUser -Name "#{username}" -NoPassword
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Local Account by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1136.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1032 Multi-factor Authentication

Use multi-factor authentication for user and privileged accounts.

### M1026 Privileged Account Management

Limit the number of accounts permitted to create other accounts. Limit the usage of local administrator accounts to be used for day-to-day operations that may expose them to potential adversaries.

## Detection

### T1136.001 Detection Strategy - Local Account Creation Across Platforms

## Risk Assessment

| Finding                            | Severity | Impact      |
| ---------------------------------- | -------- | ----------- |
| Local Account technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [cisco_username_cmd](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-t2.html#wp1047035630)
- [Cyber Security News](https://cybersecuritynews.com/superblack-actors-exploiting-two-fortinet-vulnerabilities/)
- [Kubernetes Service Accounts Security](https://kubernetes.io/docs/concepts/security/service-accounts/)
- [Microsoft User Creation Event](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/event-4720)
- [Atomic Red Team - T1136.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1136.001)
- [MITRE ATT&CK - T1136.001](https://attack.mitre.org/techniques/T1136/001)
