---
name: "T1055.004_asynchronous-procedure-call"
description: "Adversaries may inject malicious code into processes via the asynchronous procedure call (APC) queue in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055.004
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1055.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1055/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1055
  - T1055.001
  - T1055.002
  - T1055.003
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
  T1055.001: "Chain with T1055.001 for deeper attack path"
  T1055.002: "Chain with T1055.002 for deeper attack path"
---

# T1055.004 Asynchronous Procedure Call

> **Sub-technique of:** T1055

## High-Level Description

Adversaries may inject malicious code into processes via the asynchronous procedure call (APC) queue in order to evade process-based defenses as well as possibly elevate privileges. APC injection is a method of executing arbitrary code in the address space of a separate live process.

APC injection is commonly performed by attaching malicious code to the APC Queue of a process's thread. Queued APC functions are executed when the thread enters an alterable state. A handle to an existing victim process is first created with native Windows API calls such as <code>OpenThread</code>. At this point <code>QueueUserAPC</code> can be used to invoke a function (such as <code>LoadLibrayA</code> pointing to a malicious DLL).

A variation of APC injection, dubbed "Early Bird injection", involves creating a suspended process in which malicious code can be written and executed before the process' entry point (and potentially subsequent anti-malware hooks) via an APC. AtomBombing is another variation that utilizes APCs to invoke malicious code previously written to the global atom table.

Running code in the context of another process may allow access to the process's memory, system/network resources, and possibly elevated privileges. Execution via APC injection may also evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Asynchronous Procedure Call technique is applicable to target environment
- [ ] Check Windows systems for indicators of Asynchronous Procedure Call
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Process Injection via C#

Process Injection using C#
reference: https://github.com/pwndizzle/c-sharp-memory-injection
Excercises Five Techniques

1. Process injection
2. ApcInjectionAnyProcess
3. ApcInjectionNewProcess
4. IatInjection
5. ThreadHijack
   Upon successful execution, cmd.exe will execute T1055.exe, which exercises 5 techniques. Output will be via stdout.

**Supported Platforms:** windows

```cmd
"#{exe_binary}"
```

**Dependencies:**

- #{exe_binary} must be exist on system.

### Atomic Test 2: EarlyBird APC Queue Injection in Go

Creates a process in a suspended state and calls QueueUserAPC WinAPI to add a UserAPC to the child process that points to allocated shellcode.
ResumeThread is called which then calls NtTestAlert to execute the created UserAPC which then executes the shellcode.
This technique allows for the early execution of shellcode and potentially before AV/EDR can hook functions to support detection.

- PoC Credit: (https://github.com/Ne0nd0g/go-shellcode#createprocesswithpipe)
- References:
  - https://www.bleepingcomputer.com/news/security/early-bird-code-injection-technique-helps-malware-stay-undetected/
  - https://www.ired.team/offensive-security/code-injection-process-injection/early-bird-apc-queue-code-injection

**Supported Platforms:** windows

```powershell
$PathToAtomicsFolder\T1055.004\bin\x64\EarlyBird.exe -program "#{spawn_process_path}" -debug
```

### Atomic Test 3: Remote Process Injection with Go using NtQueueApcThreadEx WinAPI

Uses the undocumented NtQueueAPCThreadEx WinAPI to create a "Special User APC" in the current thread of the current process to execute shellcode.
Since the shellcode is loaded and executed in the current process it is considered local shellcode execution.

Steps taken with this technique

1. Allocate memory for the shellcode with VirtualAlloc setting the page permissions to Read/Write
2. Use the RtlCopyMemory macro to copy the shellcode to the allocated memory space
3. Change the memory page permissions to Execute/Read with VirtualProtect
4. Get a handle to the current thread
5. Execute the shellcode in the current thread by creating a Special User APC through the NtQueueApcThreadEx function

- PoC Credit: (https://github.com/Ne0nd0g/go-shellcode/tree/master#rtlcreateuserthread)
- References:
  - https://repnz.github.io/posts/apc/user-apc/
  - https://docs.rs/ntapi/0.3.1/ntapi/ntpsapi/fn.NtQueueApcThreadEx.html
  - https://0x00sec.org/t/process-injection-apc-injection/24608
  - https://twitter.com/aionescu/status/992264290924032005
  - http://www.opening-windows.com/techart_windows_vista_apc_internals2.htm#_Toc229652505

**Supported Platforms:** windows

```powershell
$PathToAtomicsFolder\T1055.004\bin\x64\NtQueueApcThreadEx.exe -debug
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Asynchronous Procedure Call by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1055.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process.

## Detection

### Behavioral Detection of Asynchronous Procedure Call (APC) Injection via Remote Thread Queuing

## Risk Assessment

| Finding                                          | Severity | Impact          |
| ------------------------------------------------ | -------- | --------------- |
| Asynchronous Procedure Call technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft APC](https://msdn.microsoft.com/library/windows/desktop/ms681951.aspx)
- [CyberBit Early Bird Apr 2018](https://www.cyberbit.com/blog/endpoint-security/new-early-bird-code-injection-technique-discovered/)
- [ENSIL AtomBombing Oct 2016](https://blog.ensilo.com/atombombing-brand-new-code-injection-for-windows)
- [Microsoft Atom Table](https://msdn.microsoft.com/library/windows/desktop/ms649053.aspx)
- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [Atomic Red Team - T1055.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055.004)
- [MITRE ATT&CK - T1055.004](https://attack.mitre.org/techniques/T1055/004)
