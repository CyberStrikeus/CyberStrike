---
name: "T1574.008_path-interception-by-search-order-hijacking"
description: "Adversaries may execute their own malicious payloads by hijacking the search order used to load other programs."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.008
  - persistence
  - privilege-escalation
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1574.008"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1574/008"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1574
  - T1574.001
  - T1574.004
  - T1574.005
  - T1574.006
  - T1574.007
  - T1574.009
  - T1574.010
  - T1574.011
  - T1574.012
  - T1574.013
  - T1574.014
prerequisites:
  - T1574
severity_boost:
  T1574: "Chain with T1574 for deeper attack path"
  T1574.001: "Chain with T1574.001 for deeper attack path"
  T1574.004: "Chain with T1574.004 for deeper attack path"
---

# T1574.008 Path Interception by Search Order Hijacking

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking the search order used to load other programs. Because some programs do not call other programs using the full path, adversaries may place their own file in the directory where the calling program is located, causing the operating system to launch their malicious software at the request of the calling program.

Search order hijacking occurs when an adversary abuses the order in which Windows searches for programs that are not given a path. Unlike DLL search order hijacking, the search order differs depending on the method that is used to execute the program. However, it is common for Windows to search in the directory of the initiating program before searching through the Windows system directory. An adversary who finds a program vulnerable to search order hijacking (i.e., a program that does not specify the path to an executable) may take advantage of this vulnerability by creating a program named after the improperly specified program and placing it within the initiating program's directory.

For example, "example.exe" runs "cmd.exe" with the command-line argument <code>net user</code>. An adversary may place a program called "net.exe" within the same directory as example.exe, "net.exe" will be run instead of the Windows system utility net. In addition, if an adversary places a program called "net.com" in the same directory as "net.exe", then <code>cmd.exe /C net user</code> will execute "net.com" instead of "net.exe" due to the order of executable extensions defined under PATHEXT.

Search order hijacking is also a common practice for hijacking DLL loads and is covered in DLL.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Path Interception by Search Order Hijacking technique is applicable to target environment
- [ ] Check Windows systems for indicators of Path Interception by Search Order Hijacking
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: powerShell Persistence via hijacking default modules - Get-Variable.exe

Colibri leverages PowerShell in a unique way to maintain persistence after a reboot. Depending on the Windows version, Colibri drops its copy in %APPDATA%\Local\Microsoft\WindowsApps and
names it Get-Variable.exe for Windows 10 and above.
https://blog.malwarebytes.com/threat-intelligence/2022/04/colibri-loader-combines-task-scheduler-and-powershell-in-clever-persistence-technique/

**Supported Platforms:** windows

```powershell
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /out:"$env:localappdata\Microsoft\WindowsApps\Get-Variable.exe" "PathToAtomicsFolder\T1574.008\bin\calc.cs"
Powershell -noprofile
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Path Interception by Search Order Hijacking by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Adversaries will likely need to place new binaries in locations to be executed through this weakness. Identify and block potentially malicious software executed path interception by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.

### M1022 Restrict File and Directory Permissions

Ensure that proper permissions and directory access control are set to deny users the ability to write files to the top-level directory <code>C:</code> and system directories, such as <code>C:\Windows\</code>, to reduce places where malicious files could be placed for execution. Require that all executables be placed in write-protected directories.

### M1047 Audit

Find and eliminate path interception weaknesses in program configuration files, scripts, the PATH environment variable, services, and in shortcuts by surrounding PATH variables with quotation marks when functions allow for them. Be aware of the search order Windows uses for executing or loading binaries and use fully qualified paths wherever appropriate.

Clean up old Windows Registry keys when software is uninstalled to avoid keys with no associated legitimate binaries. Periodically search for and correct or report path interception weaknesses on systems that may have been introduced using custom or available tools that report software using insecure path configurations.

## Detection

### Detection Strategy for Hijack Execution Flow using Path Interception by Search Order Hijacking

## Risk Assessment

| Finding                                                          | Severity | Impact      |
| ---------------------------------------------------------------- | -------- | ----------- |
| Path Interception by Search Order Hijacking technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Microsoft Environment Property](<https://docs.microsoft.com/en-us/previous-versions//fd7hxfdd(v=vs.85)?redirectedfrom=MSDN>)
- [Microsoft CreateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessa)
- [Microsoft WinExec](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-winexec)
- [Windows NT Command Shell](<https://docs.microsoft.com/en-us/previous-versions//cc723564(v=technet.10)?redirectedfrom=MSDN#XSLTsection127121120120>)
- [Atomic Red Team - T1574.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.008)
- [MITRE ATT&CK - T1574.008](https://attack.mitre.org/techniques/T1574/008)
