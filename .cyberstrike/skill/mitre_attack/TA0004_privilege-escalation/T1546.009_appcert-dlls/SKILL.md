---
name: "T1546.009_appcert-dlls"
description: "Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by AppCert DLLs loaded into processes."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.009
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.009"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/009"
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
  - T1546.010
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

# T1546.009 AppCert DLLs

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by AppCert DLLs loaded into processes. Dynamic-link libraries (DLLs) that are specified in the <code>AppCertDLLs</code> Registry key under <code>HKEY_LOCAL_MACHINE\System\CurrentControlSet\Control\Session Manager\</code> are loaded into every process that calls the ubiquitously used application programming interface (API) functions <code>CreateProcess</code>, <code>CreateProcessAsUser</code>, <code>CreateProcessWithLoginW</code>, <code>CreateProcessWithTokenW</code>, or <code>WinExec</code>. 

Similar to Process Injection, this value can be abused to obtain elevated privileges by causing a malicious DLL to be loaded and run in the context of separate processes on the computer. Malicious AppCert DLLs may also provide persistence by continuously being triggered by API activity.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if AppCert DLLs technique is applicable to target environment
- [ ] Check Windows systems for indicators of AppCert DLLs
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create registry persistence via AppCert DLL

Creates a new 'AtomicTest' value pointing to an AppCert DLL in the AppCertDlls registry key. 
Once the computer restarted, the DLL will be loaded in multiple processes and write an 
'AtomicTest.txt' file in C:\Users\Public\ to validate that the DLL executed succesfully.

Reference: https://skanthak.homepage.t-online.de/appcert.html

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Copy-Item "#{dll_path}" C:\Users\Public\AtomicTest.dll -Force
reg add "HKEY_LOCAL_MACHINE\System\CurrentControlSet\Control\Session Manager\AppCertDlls" /v "AtomicTest" /t REG_EXPAND_SZ /d "C:\Users\Public\AtomicTest.dll" /f
if(#{reboot}){Restart-Computer}
```

**Dependencies:**
- File to copy must exist on disk at specified location (#{dll_path})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to AppCert DLLs by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Adversaries install new AppCertDLL binaries to execute this technique. Identify and block potentially malicious software executed through AppCertDLLs functionality by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.


## Detection

### Detection Strategy for AppCert DLLs Persistence via Registry Injection


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| AppCert DLLs technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [Sysinternals AppCertDlls Oct 2007](https://web.archive.org/web/20130401232752/https://forum.sysinternals.com/appcertdlls_topic12546.html)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Atomic Red Team - T1546.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.009)
- [MITRE ATT&CK - T1546.009](https://attack.mitre.org/techniques/T1546/009)
