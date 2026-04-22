---
name: "T1078.003_local-accounts"
description: "Adversaries may obtain and abuse credentials of a local account as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1078.003
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
  - linux
  - macos
  - windows
  - containers
  - network-devices
  - esxi
  - sub-technique
technique_id: "T1078.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
  - privilege-escalation
  - initial-access
platforms:
  - Linux
  - macOS
  - Windows
  - Containers
  - Network Devices
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1078/003"
tech_stack:
  - linux
  - macos
  - windows
  - containers
  - network devices
  - esxi
cwe_ids:
  - CWE-693
chains_with:
  - T1078
  - T1078.001
  - T1078.002
  - T1078.004
prerequisites:
  - T1078
severity_boost:
  T1078: "Chain with T1078 for deeper attack path"
  T1078.001: "Chain with T1078.001 for deeper attack path"
  T1078.002: "Chain with T1078.002 for deeper attack path"
---

# T1078.003 Local Accounts

> **Sub-technique of:** T1078

## High-Level Description

Adversaries may obtain and abuse credentials of a local account as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion. Local accounts are those configured by an organization for use by users, remote support, services, or for administration on a single system or service.

Local Accounts may also be abused to elevate privileges and harvest credentials through OS Credential Dumping. Password reuse may allow the abuse of local accounts across a set of machines on a network for the purposes of Privilege Escalation and Lateral Movement.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Initial Access (TA0001)

**Platforms:** Linux, macOS, Windows, Containers, Network Devices, ESXi

## What to Check

- [ ] Identify if Local Accounts technique is applicable to target environment
- [ ] Check Linux systems for indicators of Local Accounts
- [ ] Check macOS systems for indicators of Local Accounts
- [ ] Check Windows systems for indicators of Local Accounts
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create local account with admin privileges

After execution the new account will be active and added to the Administrators group

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
net user art-test /add
net user art-test #{password}
net localgroup administrators art-test /add
```

### Atomic Test 2: Create local account with admin privileges - MacOS

After execution the new account will be active and added to the Administrators group

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
dscl . -create /Users/AtomicUser
dscl . -create /Users/AtomicUser UserShell /bin/bash
dscl . -create /Users/AtomicUser RealName "Atomic User"
dscl . -create /Users/AtomicUser UniqueID 503
dscl . -create /Users/AtomicUser PrimaryGroupID 503
dscl . -create /Users/AtomicUser NFSHomeDirectory /Local/Users/AtomicUser
dscl . -passwd /Users/AtomicUser mySecretPassword
dscl . -append /Groups/admin GroupMembership AtomicUser
```

### Atomic Test 3: Create local account with admin privileges using sysadminctl utility - MacOS

After execution the new account will be active and added to the Administrators group

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sysadminctl interactive -addUser art-tester -fullName ARTUser -password !pass123! -admin
```

### Atomic Test 4: Enable root account using dsenableroot utility - MacOS

After execution the current/new user will have root access

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
dsenableroot #current user
dsenableroot -u art-tester -p art-tester -r art-root #new user
```

### Atomic Test 5: Add a new/existing user to the admin group using dseditgroup utility - macOS

After execution the current/new user will be added to the Admin group

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
dseditgroup -o edit -a art-user -t user admin
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Local Accounts by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1078.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Audit local accounts permission levels routinely to look for situations that could allow an adversary to gain wide access by obtaining credentials of a privileged account. Limit the usage of local administrator accounts to be used for day-to-day operations that may expose them to potential adversaries.

For example, audit the use of service accounts in Kubernetes, and avoid automatically granting them access to the Kubernetes API if this is not required. Implementing LAPS may also help prevent reuse of local administrator credentials across a domain.

### M1032 Multi-factor Authentication

Enable multi-factor authentication (MFA) for local accounts to add an extra layer of protection against credential theft and misuse. MFA can be implemented using methods like mobile-based authenticators or hardware tokens, even in environments that do not rely on domain controllers or cloud services. This additional security measure can help reduce the risk of adversaries gaining unauthorized access to local systems and resources.

### M1027 Password Policies

Ensure that local administrator accounts have complex, unique passwords across all systems on the network.

### M1018 User Account Management

Enforce user account management practices for local accounts to limit access and remove inactive or unused accounts. By doing so, you reduce the attack surface available to adversaries and prevent unauthorized access to local systems.

## Detection

### Detection of Local Account Abuse for Initial Access and Persistence

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| Local Accounts technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Atomic Red Team - T1078.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1078.003)
- [MITRE ATT&CK - T1078.003](https://attack.mitre.org/techniques/T1078/003)
