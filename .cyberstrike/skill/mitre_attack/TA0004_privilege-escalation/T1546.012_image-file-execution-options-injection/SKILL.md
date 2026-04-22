---
name: "T1546.012_image-file-execution-options-injection"
description: "Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by Image File Execution Options (IFEO) debuggers."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.012
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.012"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/012"
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
  - T1546.011
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

# T1546.012 Image File Execution Options Injection

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by Image File Execution Options (IFEO) debuggers. IFEOs enable a developer to attach a debugger to an application. When a process is created, a debugger present in an application’s IFEO will be prepended to the application’s name, effectively launching the new process under the debugger (e.g., <code>C:\dbg\ntsd.exe -g notepad.exe</code>). 

IFEOs can be set directly via the Registry or in Global Flags via the GFlags tool. IFEOs are represented as <code>Debugger</code> values in the Registry under <code>HKLM\SOFTWARE{\Wow6432Node}\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\<executable></code> where <code>&lt;executable&gt;</code> is the binary on which the debugger is attached. 

IFEOs can also enable an arbitrary monitor program to be launched when a specified program silently exits (i.e. is prematurely terminated by itself or a second, non kernel-mode process). Similar to debuggers, silent exit monitoring can be enabled through GFlags and/or by directly modifying IFEO and silent process exit Registry values in <code>HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SilentProcessExit\</code>. 

Similar to Accessibility Features, on Windows Vista and later as well as Windows Server 2008 and later, a Registry key may be modified that configures "cmd.exe," or another program that provides backdoor access, as a "debugger" for an accessibility program (ex: utilman.exe). After the Registry is modified, pressing the appropriate key combination at the login screen while at the keyboard or when connected with Remote Desktop Protocol will cause the "debugger" program to be executed with SYSTEM privileges. 

Similar to Process Injection, these values may also be abused to obtain privilege escalation by causing a malicious executable to be loaded and run in the context of separate processes on the computer. Installing IFEO mechanisms may also provide Persistence via continuous triggered invocation.

Malware may also use IFEO to Impair Defenses by registering invalid debuggers that redirect and effectively disable various system and security applications.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Image File Execution Options Injection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Image File Execution Options Injection
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: IFEO Add Debugger

Leverage Global Flags Settings

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
REG ADD "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\#{target_binary}" /v Debugger /d "#{payload_binary}"
```

### Atomic Test 2: IFEO Global Flags

Leverage Global Flags Settings

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
REG ADD "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\#{target_binary}" /v GlobalFlag /t REG_DWORD /d 512
REG ADD "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SilentProcessExit\#{target_binary}" /v ReportingMode /t REG_DWORD /d 1
REG ADD "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SilentProcessExit\#{target_binary}" /v MonitorProcess /d "#{payload_binary}"
```

### Atomic Test 3: GlobalFlags in Image File Execution Options

The following Atomic Test will create a GlobalFlag key under Image File Execution Options, also a SilentProcessExit Key with ReportingMode and MonitorProcess values. This test is similar to a recent CanaryToken that will generate an EventCode 3000 in the Application log when a command, whoami.exe for example, is executed.
Upon running Whoami.exe, a command shell will spawn and start calc.exe based on the MonitorProcess value. 
Upon successful execution, powershell will modify the registry and spawn calc.exe. An event 3000 will generate in the Application log.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$Name = "GlobalFlag"
$Value = "512"
$registryPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\#{process}"
New-Item -Path $registryPath -Force
New-ItemProperty -Path $registryPath -Name $Name -Value $Value -PropertyType DWord -Force
$Name = "ReportingMode"
$Value = "1"
$SilentProcessExit = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SilentProcessExit\#{process}"
New-Item -Path $SilentProcessExit -Force
New-ItemProperty -Path $SilentProcessExit -Name $Name -Value $Value -PropertyType DWord -Force 

$Name = "MonitorProcess"
$Value = "#{cmd_to_run}"
New-ItemProperty -Path $SilentProcessExit -Name $Name -Value $Value -PropertyType String -Force
Start-Process whoami.exe
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Image File Execution Options Injection by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for IFEO Injection on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Image File Execution Options Injection technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [FSecure Hupigon](https://www.f-secure.com/v-descs/backdoor_w32_hupigon_emv.shtml)
- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [Microsoft Silent Process Exit NOV 2017](https://docs.microsoft.com/windows-hardware/drivers/debugger/registry-entries-for-silent-process-exit)
- [Microsoft GFlags Mar 2017](https://docs.microsoft.com/windows-hardware/drivers/debugger/gflags-overview)
- [Oddvar Moe IFEO APR 2018](https://oddvar.moe/2018/04/10/persistence-using-globalflags-in-image-file-execution-options-hidden-from-autoruns-exe/)
- [Microsoft Dev Blog IFEO Mar 2010](https://blogs.msdn.microsoft.com/mithuns/2010/03/24/image-file-execution-options-ifeo/)
- [Symantec Ushedix June 2008](https://www.symantec.com/security_response/writeup.jsp?docid=2008-062807-2501-99&tabid=2)
- [Tilbury 2014](https://web.archive.org/web/20200730053039/https://www.crowdstrike.com/blog/registry-analysis-with-crowdresponse/)
- [Atomic Red Team - T1546.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.012)
- [MITRE ATT&CK - T1546.012](https://attack.mitre.org/techniques/T1546/012)
