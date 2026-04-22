---
name: "T1546.010_appinit-dlls"
description: "Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by AppInit DLLs loaded into processes."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.010
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.010"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/010"
tech_stack:
  - windows
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.010 AppInit DLLs

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by AppInit DLLs loaded into processes. Dynamic-link libraries (DLLs) that are specified in the <code>AppInit_DLLs</code> value in the Registry keys <code>HKEY_LOCAL_MACHINE\Software\Microsoft\Windows NT\CurrentVersion\Windows</code> or <code>HKEY_LOCAL_MACHINE\Software\Wow6432Node\Microsoft\Windows NT\CurrentVersion\Windows</code> are loaded by user32.dll into every process that loads user32.dll. In practice this is nearly every program, since user32.dll is a very common library. 

Similar to Process Injection, these values can be abused to obtain elevated privileges by causing a malicious DLL to be loaded and run in the context of separate processes on the computer. Malicious AppInit DLLs may also provide persistence by continuously being triggered by API activity. 

The AppInit DLL functionality is disabled in Windows 8 and later versions when secure boot is enabled.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if AppInit DLLs technique is applicable to target environment
- [ ] Check Windows systems for indicators of AppInit DLLs
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Install AppInit Shim

AppInit_DLLs is a mechanism that allows an arbitrary list of DLLs to be loaded into each user mode process on the system. Upon succesfully execution, 
you will see the message "The operation completed successfully." Each time the DLL is loaded, you will see a message box with a message of "Install AppInit Shim DLL was called!" appear.
This will happen regularly as your computer starts up various applications and may in fact drive you crazy. A reliable way to make the message box appear and verify the 
AppInit Dlls are loading is to start the notepad application. Be sure to run the cleanup commands afterwards so you don't keep getting message boxes showing up.

Note: If secure boot is enabled, this technique will not work. https://docs.microsoft.com/en-us/windows/win32/dlls/secure-boot-and-appinit-dlls

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg.exe import "#{registry_file}"
```

**Dependencies:**
- Reg files must exist on disk at specified locations (#{registry_file} and #{registry_cleanup_file})
- DLL's must exist in the C:\Tools directory (T1546.010.dll and T1546.010x86.dll)


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to AppInit DLLs by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Adversaries can install new AppInit DLLs binaries to execute this technique. Identify and block potentially malicious software executed through AppInit DLLs functionality by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.

### M1051 Update Software
Upgrade to Windows 8 or later and enable secure boot.


## Detection

### Detection Strategy for Event Triggered Execution: AppInit DLLs (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AppInit DLLs technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [AppInit Registry](https://support.microsoft.com/en-us/kb/197571)
- [AppInit Secure Boot](https://msdn.microsoft.com/en-us/library/dn280412)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Atomic Red Team - T1546.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.010)
- [MITRE ATT&CK - T1546.010](https://attack.mitre.org/techniques/T1546/010)
