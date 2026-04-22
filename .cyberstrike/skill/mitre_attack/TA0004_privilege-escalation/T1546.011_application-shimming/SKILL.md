---
name: "T1546.011_application-shimming"
description: "Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by application shims."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.011
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.011"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/011"
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
  - T1546.010
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

# T1546.011 Application Shimming

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by application shims. The Microsoft Windows Application Compatibility Infrastructure/Framework (Application Shim) was created to allow for backward compatibility of software as the operating system codebase changes over time. For example, the application shimming feature allows developers to apply fixes to applications (without rewriting code) that were created for Windows XP so that it will work with Windows 10. 

Within the framework, shims are created to act as a buffer between the program (or more specifically, the Import Address Table) and the Windows OS. When a program is executed, the shim cache is referenced to determine if the program requires the use of the shim database (.sdb). If so, the shim database uses hooking to redirect the code as necessary in order to communicate with the OS. 

A list of all shims currently installed by the default Windows installer (sdbinst.exe) is kept in:

* <code>%WINDIR%\AppPatch\sysmain.sdb</code> and
* <code>hklm\software\microsoft\windows nt\currentversion\appcompatflags\installedsdb</code>

Custom databases are stored in:

* <code>%WINDIR%\AppPatch\custom & %WINDIR%\AppPatch\AppPatch64\Custom</code> and
* <code>hklm\software\microsoft\windows nt\currentversion\appcompatflags\custom</code>

To keep shims secure, Windows designed them to run in user mode so they cannot modify the kernel and you must have administrator privileges to install a shim. However, certain shims can be used to Bypass User Account Control (UAC and RedirectEXE), inject DLLs into processes (InjectDLL), disable Data Execution Prevention (DisableNX) and Structure Exception Handling (DisableSEH), and intercept memory addresses (GetProcAddress).

Utilizing these shims may allow an adversary to perform several malicious acts such as elevate privileges, install backdoors, disable defenses like Windows Defender, etc. Shims can also be abused to establish persistence by continuously being invoked by affected programs.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Application Shimming technique is applicable to target environment
- [ ] Check Windows systems for indicators of Application Shimming
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Application Shim Installation

Install a shim database. This technique is used for privilege escalation and bypassing user access control.
Upon execution, "Installation of AtomicShim complete." will be displayed. To verify the shim behavior, run 
the AtomicTest.exe from the <PathToAtomicsFolder>\\T1546.011\\bin directory. You should see a message box appear
with "Atomic Shim DLL Test!" as defined in the AtomicTest.dll. To better understand what is happening, review
the source code files is the <PathToAtomicsFolder>\\T1546.011\\src directory.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
sdbinst.exe "#{file_path}"
```

**Dependencies:**
- Shim database file must exist on disk at specified location (#{file_path})
- AtomicTest.dll must exist at c:\Tools\AtomicTest.dll

### Atomic Test 2: New shim database files created in the default shim database directory

Upon execution, check the "C:\Windows\apppatch\Custom\" folder for the new shim database

https://www.fireeye.com/blog/threat-research/2017/05/fin7-shim-databases-persistence.html

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Copy-Item "$PathToAtomicsFolder\T1546.011\bin\T1546.011CompatDatabase.sdb" C:\Windows\apppatch\Custom\T1546.011CompatDatabase.sdb
Copy-Item "$PathToAtomicsFolder\T1546.011\bin\T1546.011CompatDatabase.sdb" C:\Windows\apppatch\Custom\Custom64\T1546.011CompatDatabase.sdb
```

### Atomic Test 3: Registry key creation and/or modification events for SDB

Create registry keys in locations where fin7 typically places SDB patches. Upon execution, output will be displayed describing
the registry keys that were created. These keys can also be viewed using the Registry Editor.

https://www.fireeye.com/blog/threat-research/2017/05/fin7-shim-databases-persistence.html

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-ItemProperty -Path HKLM:"\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Custom" -Name "AtomicRedTeamT1546.011" -Value "AtomicRedTeamT1546.011"
New-ItemProperty -Path HKLM:"\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\InstalledSDB" -Name "AtomicRedTeamT1546.011" -Value "AtomicRedTeamT1546.011"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Application Shimming by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.011 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1052 User Account Control
Changing UAC settings to "Always Notify" will give the user more visibility when UAC elevation is requested, however, this option will not be popular among users due to the constant UAC interruptions.

### M1051 Update Software
Microsoft released an optional patch update - KB3045645 - that will remove the "auto-elevate" flag within the sdbinst.exe. This will prevent use of application shimming to bypass UAC.


## Detection

### Detection Strategy for Application Shimming via sdbinst.exe and Registry Artifacts (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Application Shimming technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [FireEye Application Shimming](http://files.brucon.org/2015/Tomczak_and_Ballenthin_Shims_for_the_Win.pdf)
- [Black Hat 2015 App Shim](https://www.blackhat.com/docs/eu-15/materials/eu-15-Pierce-Defending-Against-Malicious-Application-Compatibility-Shims-wp.pdf)
- [Atomic Red Team - T1546.011](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.011)
- [MITRE ATT&CK - T1546.011](https://attack.mitre.org/techniques/T1546/011)
