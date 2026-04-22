---
name: "T1559_inter-process-communication"
description: "Adversaries may abuse inter-process communication (IPC) mechanisms for local code or command execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1559
  - execution
  - linux
  - macos
  - windows
technique_id: "T1559"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1559"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1559.001
  - T1559.002
  - T1559.003
prerequisites: []
severity_boost:
  T1559.001: "Chain with T1559.001 for deeper attack path"
  T1559.002: "Chain with T1559.002 for deeper attack path"
  T1559.003: "Chain with T1559.003 for deeper attack path"
---

# T1559 Inter-Process Communication

## High-Level Description

Adversaries may abuse inter-process communication (IPC) mechanisms for local code or command execution. IPC is typically used by processes to share data, communicate with each other, or synchronize execution. IPC is also commonly used to avoid situations such as deadlocks, which occurs when processes are stuck in a cyclic waiting pattern.

Adversaries may abuse IPC to execute arbitrary code or commands. IPC mechanisms may differ depending on OS, but typically exists in a form accessible through programming languages/libraries or native interfaces such as Windows Dynamic Data Exchange or Component Object Model. Linux environments support several different IPC mechanisms, two of which being sockets and pipes. Higher level execution mediums, such as those of Command and Scripting Interpreters, may also leverage underlying IPC mechanisms. Adversaries may also use Remote Services such as Distributed Component Object Model to facilitate remote IPC execution.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Inter-Process Communication technique is applicable to target environment
- [ ] Check Linux systems for indicators of Inter-Process Communication
- [ ] Check macOS systems for indicators of Inter-Process Communication
- [ ] Check Windows systems for indicators of Inter-Process Communication
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Cobalt Strike Artifact Kit pipe

Uses the [Named Pipes Micro Emulation](https://github.com/center-for-threat-informed-defense/adversary_emulation_library/tree/master/micro_emulation_plans/src/named_pipes) executable from the Center for Threat Informed Defense to create a named pipe for inter-process communication.

The named pipe executable will pause for 30 seconds to allow the client and server to exchange a message through the pipe.

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\build\namedpipes_executor.exe" --pipe 1
```

**Dependencies:**

- Named pipe executors must exist on disk

### Atomic Test 2: Cobalt Strike Lateral Movement (psexec_psh) pipe

Uses the [Named Pipes Micro Emulation](https://github.com/center-for-threat-informed-defense/adversary_emulation_library/tree/master/micro_emulation_plans/src/named_pipes) executable from the Center for Threat Informed Defense to create a named pipe for inter-process communication.

The named pipe executable will pause for 30 seconds to allow the client and server to exchange a message through the pipe.

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\build\namedpipes_executor.exe" --pipe 2
```

**Dependencies:**

- Named pipe executors must exist on disk

### Atomic Test 3: Cobalt Strike SSH (postex_ssh) pipe

Uses the [Named Pipes Micro Emulation](https://github.com/center-for-threat-informed-defense/adversary_emulation_library/tree/master/micro_emulation_plans/src/named_pipes) executable from the Center for Threat Informed Defense to create a named pipe for inter-process communication.

The named pipe executable will pause for 30 seconds to allow the client and server to exchange a message through the pipe.

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\build\namedpipes_executor.exe" --pipe 3
```

**Dependencies:**

- Named pipe executors must exist on disk

### Atomic Test 4: Cobalt Strike post-exploitation pipe (4.2 and later)

Uses the [Named Pipes Micro Emulation](https://github.com/center-for-threat-informed-defense/adversary_emulation_library/tree/master/micro_emulation_plans/src/named_pipes) executable from the Center for Threat Informed Defense to create a named pipe for inter-process communication.

The named pipe executable will pause for 30 seconds to allow the client and server to exchange a message through the pipe.

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\build\namedpipes_executor.exe" --pipe 4
```

**Dependencies:**

- Named pipe executors must exist on disk

### Atomic Test 5: Cobalt Strike post-exploitation pipe (before 4.2)

Uses the [Named Pipes Micro Emulation](https://github.com/center-for-threat-informed-defense/adversary_emulation_library/tree/master/micro_emulation_plans/src/named_pipes) executable from the Center for Threat Informed Defense to create a named pipe for inter-process communication.

The named pipe executable will pause for 30 seconds to allow the client and server to exchange a message through the pipe.

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\build\namedpipes_executor.exe" --pipe 5
```

**Dependencies:**

- Named pipe executors must exist on disk

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Inter-Process Communication by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1559 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Registry keys specific to Microsoft Office feature control security can be set to disable automatic DDE/OLE execution. Microsoft also created, and enabled by default, Registry keys to completely disable DDE execution in Word and Excel.

### M1054 Software Configuration

Consider disabling embedded files in Office programs, such as OneNote, that do not work with Protected View.

### M1048 Application Isolation and Sandboxing

Ensure all COM alerts and Protected View are enabled.

### M1026 Privileged Account Management

Modify Registry settings (directly or using Dcomcnfg.exe) in `HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\AppID\\{AppID_GUID}` associated with the process-wide security of individual COM applications.

Modify Registry settings (directly or using Dcomcnfg.exe) in `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Ole` associated with system-wide security defaults for all COM applications that do no set their own process-wide security.

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent DDE attacks and spawning of child processes from Office programs.

### M1013 Application Developer Guidance

Enable the Hardened Runtime capability when developing applications. Do not include the <code>com.apple.security.get-task-allow</code> entitlement with the value set to any variation of true.

## Detection

### Detect Abuse of Inter-Process Communication (T1559)

## Risk Assessment

| Finding                                          | Severity | Impact    |
| ------------------------------------------------ | -------- | --------- |
| Inter-Process Communication technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Fireeye Hunting COM June 2019](https://www.fireeye.com/blog/threat-research/2019/06/hunting-com-objects.html)
- [Linux IPC](<https://www.geeksforgeeks.org/inter-process-communication-ipc/#:~:text=Inter%2Dprocess%20communication%20(IPC),of%20co%2Doperation%20between%20them.>)
- [Atomic Red Team - T1559](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1559)
- [MITRE ATT&CK - T1559](https://attack.mitre.org/techniques/T1559)
