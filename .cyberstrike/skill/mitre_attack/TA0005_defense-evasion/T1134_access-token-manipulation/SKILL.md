---
name: "T1134_access-token-manipulation"
description: "Adversaries may modify access tokens to operate under a different user or system security context to perform actions and bypass access controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1134
  - defense-evasion
  - privilege-escalation
  - windows
technique_id: "T1134"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1134"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1134.001
  - T1134.002
  - T1134.003
  - T1134.004
  - T1134.005
prerequisites: []
severity_boost:
  T1134.001: "Chain with T1134.001 for deeper attack path"
  T1134.002: "Chain with T1134.002 for deeper attack path"
  T1134.003: "Chain with T1134.003 for deeper attack path"
---

# T1134 Access Token Manipulation

## High-Level Description

Adversaries may modify access tokens to operate under a different user or system security context to perform actions and bypass access controls. Windows uses access tokens to determine the ownership of a running process. A user can manipulate access tokens to make a running process appear as though it is the child of a different process or belongs to someone other than the user that started the process. When this occurs, the process also takes on the security context associated with the new token.

An adversary can use built-in Windows API functions to copy access tokens from existing processes; this is known as token stealing. These token can then be applied to an existing process (i.e. Token Impersonation/Theft) or used to spawn a new process (i.e. Create Process with Token). An adversary must already be in a privileged user context (i.e. administrator) to steal a token. However, adversaries commonly use token stealing to elevate their security context from the administrator level to the SYSTEM level. An adversary can then use a token to authenticate to a remote system as the account for that token if the account has appropriate permissions on the remote system.

Any standard user can use the <code>runas</code> command, and the Windows API functions, to create impersonation tokens; it does not require access to an administrator account. There are also other mechanisms, such as Active Directory fields, that can be used to modify access tokens.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Access Token Manipulation technique is applicable to target environment
- [ ] Check Windows systems for indicators of Access Token Manipulation
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Access Token Manipulation by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1134 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

An adversary must already have administrator level access on the local system to make full use of this technique; be sure to restrict users and accounts to the least privileges they require.

### M1026 Privileged Account Management

Limit permissions so that users and user groups cannot create tokens. This setting should be defined for the local system account only. GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Create a token object. Also define who can create a process level token to only the local and network service through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Replace a process level token.

Administrators should log in as a standard user but run their tools with administrator privileges using the built-in access token manipulation command <code>runas</code>.

## Detection

### Behavior-chain detection for T1134 Access Token Manipulation on Windows

## Risk Assessment

| Finding                                        | Severity | Impact          |
| ---------------------------------------------- | -------- | --------------- |
| Access Token Manipulation technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [BlackHat Atkinson Winchester Token Manipulation](https://www.blackhat.com/docs/eu-17/materials/eu-17-Atkinson-A-Process-Is-No-One-Hunting-For-Token-Manipulation.pdf)
- [Microsoft Command-line Logging](https://technet.microsoft.com/en-us/windows-server-docs/identity/ad-ds/manage/component-updates/command-line-process-auditing)
- [Microsoft LogonUser](<https://msdn.microsoft.com/en-us/library/windows/desktop/aa378184(v=vs.85).aspx>)
- [Microsoft DuplicateTokenEx](<https://msdn.microsoft.com/en-us/library/windows/desktop/aa446617(v=vs.85).aspx>)
- [Microsoft ImpersonateLoggedOnUser](<https://msdn.microsoft.com/en-us/library/windows/desktop/aa378612(v=vs.85).aspx>)
- [Pentestlab Token Manipulation](https://pentestlab.blog/2017/04/03/token-manipulation/)
- [Atomic Red Team - T1134](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1134)
- [MITRE ATT&CK - T1134](https://attack.mitre.org/techniques/T1134)
