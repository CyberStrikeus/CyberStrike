---
name: "T1622_debugger-evasion"
description: "Adversaries may employ various means to detect and avoid debuggers."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1622
  - defense-evasion
  - discovery
  - linux
  - macos
  - windows
technique_id: "T1622"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1622"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1622 Debugger Evasion

## High-Level Description

Adversaries may employ various means to detect and avoid debuggers. Debuggers are typically used by defenders to trace and/or analyze the execution of potential malware payloads.

Debugger evasion may include changing behaviors based on the results of the checks for the presence of artifacts indicative of a debugged environment. Similar to Virtualization/Sandbox Evasion, if the adversary detects a debugger, they may alter their malware to disengage from the victim or conceal the core functions of the implant. They may also search for debugger artifacts before dropping secondary or additional payloads.

Specific checks will vary based on the target and/or adversary. On Windows, this may involve Native API function calls such as <code>IsDebuggerPresent()</code> and <code> NtQueryInformationProcess()</code>, or manually checking the <code>BeingDebugged</code> flag of the Process Environment Block (PEB). On Linux, this may involve querying `/proc/self/status` for the `TracerPID` field, which indicates whether or not the process is being traced by dynamic analysis tools. Other checks for debugging artifacts may also seek to enumerate hardware breakpoints, interrupt assembly opcodes, time checks, or measurements if exceptions are raised in the current process (assuming a present debugger would “swallow” or handle the potential error).

Malware may also leverage Structured Exception Handling (SEH) to detect debuggers by throwing an exception and detecting whether the process is suspended. SEH handles both hardware and software expectations, providing control over the exceptions including support for debugging. If a debugger is present, the program’s control will be transferred to the debugger, and the execution of the code will be suspended. If the debugger is not present, control will be transferred to the SEH handler, which will automatically handle the exception and allow the program’s execution to continue.

Adversaries may use the information learned from these debugger checks during automated discovery to shape follow-on behaviors. Debuggers can also be evaded by detaching the process or flooding debug logs with meaningless data via messages produced by looping Native API function calls such as <code>OutputDebugStringW()</code>.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Debugger Evasion technique is applicable to target environment
- [ ] Check Linux systems for indicators of Debugger Evasion
- [ ] Check macOS systems for indicators of Debugger Evasion
- [ ] Check Windows systems for indicators of Debugger Evasion
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Detect a Debugger Presence in the Machine

Detecting a running debugger process or if the debugger is attached to a process via PowerShell

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
# Check for common debugger processes
$debuggerProcesses = Get-Process | Where-Object { $_.ProcessName -match "dbg" -or $_.ProcessName -match "debug" }
# Check for debugging flags
$debuggingFlags = [System.Diagnostics.Debugger]::IsAttached
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Debugger Evasion by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1622 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Debugger Evasion (T1622)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Debugger Evasion technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Apriorit](https://www.apriorit.com/dev-blog/367-anti-reverse-engineering-protection-techniques-to-use-before-releasing-software)
- [Checkpoint Dridex Jan 2021](https://research.checkpoint.com/2021/stopping-serial-killer-catching-the-next-strike/)
- [hasherezade debug](https://github.com/hasherezade/malware_training_vol1/blob/main/slides/module3/Module3_2_fingerprinting.pdf)
- [Cado Security P2PInfect 2023](https://www.cadosecurity.com/blog/p2pinfect-new-variant-targets-mips-devices)
- [AlKhaser Debug](https://github.com/LordNoteworthy/al-khaser/tree/master/al-khaser/AntiDebug)
- [wardle evilquest partii](https://objective-see.com/blog/blog_0x60.html)
- [ProcessHacker Github](https://github.com/processhacker/processhacker)
- [Positive Technologies Hellhounds 2023](https://global.ptsecurity.com/analytics/pt-esc-threat-intelligence/hellhounds-operation-lahat)
- [vxunderground debug](https://github.com/vxunderground/VX-API/tree/main/Anti%20Debug)
- [Atomic Red Team - T1622](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1622)
- [MITRE ATT&CK - T1622](https://attack.mitre.org/techniques/T1622)
