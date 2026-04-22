---
name: "T1134.003_make-and-impersonate-token"
description: "Adversaries may make new tokens and impersonate users to escalate privileges and bypass access controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1134.003
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1134.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1134/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1134
  - T1134.001
  - T1134.002
  - T1134.004
  - T1134.005
prerequisites:
  - T1134
severity_boost:
  T1134: "Chain with T1134 for deeper attack path"
  T1134.001: "Chain with T1134.001 for deeper attack path"
  T1134.002: "Chain with T1134.002 for deeper attack path"
---

# T1134.003 Make and Impersonate Token

> **Sub-technique of:** T1134

## High-Level Description

Adversaries may make new tokens and impersonate users to escalate privileges and bypass access controls. For example, if an adversary has a username and password but the user is not logged onto the system the adversary can then create a logon session for the user using the `LogonUser` function. The function will return a copy of the new session's access token and the adversary can use `SetThreadToken` to assign the token to a thread.

This behavior is distinct from Token Impersonation/Theft in that this refers to creating a new user token instead of stealing or duplicating an existing one.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Make and Impersonate Token technique is applicable to target environment
- [ ] Check Windows systems for indicators of Make and Impersonate Token
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Make and Impersonate Token by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1134.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management
Limit permissions so that users and user groups cannot create tokens. This setting should be defined for the local system account only. GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Create a token object. Also define who can create a process level token to only the local and network service through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Replace a process level token.

Administrators should log in as a standard user but run their tools with administrator privileges using the built-in access token manipulation command <code>runas</code>.

### M1018 User Account Management
An adversary must already have administrator level access on the local system to make full use of this technique; be sure to restrict users and accounts to the least privileges they require.


## Detection

### Behavior‑chain detection for T1134.003 Make and Impersonate Token (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Make and Impersonate Token technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Microsoft Command-line Logging](https://technet.microsoft.com/en-us/windows-server-docs/identity/ad-ds/manage/component-updates/command-line-process-auditing)
- [LogonUserW function](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-logonuserw)
- [Atomic Red Team - T1134.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1134.003)
- [MITRE ATT&CK - T1134.003](https://attack.mitre.org/techniques/T1134/003)
