---
name: "T1574.009_path-interception-by-unquoted-path"
description: "Adversaries may execute their own malicious payloads by hijacking vulnerable file path references."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.009
  - persistence
  - privilege-escalation
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1574.009"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1574/009"
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
  - T1574.008
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

# T1574.009 Path Interception by Unquoted Path

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may execute their own malicious payloads by hijacking vulnerable file path references. Adversaries can take advantage of paths that lack surrounding quotations by placing an executable in a higher level directory within the path, so that Windows will choose the adversary's executable to launch.

Service paths and shortcut paths may also be vulnerable to path interception if the path has one or more spaces and is not surrounded by quotation marks (e.g., <code>C:\unsafe path with space\program.exe</code> vs. <code>"C:\safe path with space\program.exe"</code>). (stored in Windows Registry keys) An adversary can place an executable in a higher level directory of the path, and Windows will resolve that executable instead of the intended executable. For example, if the path in a shortcut is <code>C:\program files\myapp.exe</code>, an adversary may create a program at <code>C:\program.exe</code> that will be run instead of the intended program.

This technique can be used for persistence if executables are called on a regular basis, as well as privilege escalation if intercepted executables are started by a higher privileged process.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Path Interception by Unquoted Path technique is applicable to target environment
- [ ] Check Windows systems for indicators of Path Interception by Unquoted Path
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Execution of program.exe as service with unquoted service path

When a service is created whose executable path contains spaces and isn’t enclosed within quotes, leads to a vulnerability
known as Unquoted Service Path which allows a user to gain SYSTEM privileges.
In this case, if an executable program.exe in C:\ exists, C:\program.exe will be executed instead of test.exe in C:\Program Files\subfolder\test.exe.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
copy "#{service_executable}" "C:\Program Files\windows_service.exe"
copy "#{service_executable}" "C:\program.exe"
sc create "Example Service" binpath= "C:\Program Files\windows_service.exe" Displayname= "Example Service" start= auto
sc start "Example Service"
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Path Interception by Unquoted Path by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

Find and eliminate path interception weaknesses in program configuration files, scripts, the PATH environment variable, services, and in shortcuts by surrounding PATH variables with quotation marks when functions allow for them. Be aware of the search order Windows uses for executing or loading binaries and use fully qualified paths wherever appropriate.

Clean up old Windows Registry keys when software is uninstalled to avoid keys with no associated legitimate binaries. Periodically search for and correct or report path interception weaknesses on systems that may have been introduced using custom or available tools that report software using insecure path configurations.

### M1038 Execution Prevention

Adversaries will likely need to place new binaries in locations to be executed through this weakness. Identify and block potentially malicious software executed path interception by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.

### M1022 Restrict File and Directory Permissions

Ensure that proper permissions and directory access control are set to deny users the ability to write files to the top-level directory <code>C:</code> and system directories, such as <code>C:\Windows\</code>, to reduce places where malicious files could be placed for execution. Require that all executables be placed in write-protected directories.

## Detection

### Detection Strategy for Hijack Execution Flow through Path Interception by Unquoted Path

## Risk Assessment

| Finding                                                 | Severity | Impact      |
| ------------------------------------------------------- | -------- | ----------- |
| Path Interception by Unquoted Path technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Windows Privilege Escalation Guide](https://www.absolomb.com/2018-01-26-Windows-Privilege-Escalation-Guide/)
- [Windows Unquoted Services](https://securityboulevard.com/2018/04/windows-privilege-escalation-unquoted-services/)
- [Help eliminate unquoted path](https://isc.sans.edu/diary/Help+eliminate+unquoted+path+vulnerabilities/14464)
- [Microsoft CurrentControlSet Services](https://docs.microsoft.com/en-us/windows-hardware/drivers/install/hklm-system-currentcontrolset-services-registry-tree)
- [Atomic Red Team - T1574.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.009)
- [MITRE ATT&CK - T1574.009](https://attack.mitre.org/techniques/T1574/009)
