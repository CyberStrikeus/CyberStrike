---
name: "T1055.002_portable-executable-injection"
description: "Adversaries may inject portable executables (PE) into processes in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055.002
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1055.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1055/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1055
  - T1055.001
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
  T1055.001: "Chain with T1055.001 for deeper attack path"
  T1055.003: "Chain with T1055.003 for deeper attack path"
---

# T1055.002 Portable Executable Injection

> **Sub-technique of:** T1055

## High-Level Description

Adversaries may inject portable executables (PE) into processes in order to evade process-based defenses as well as possibly elevate privileges. PE injection is a method of executing arbitrary code in the address space of a separate live process.

PE injection is commonly performed by copying code (perhaps without a file on disk) into the virtual address space of the target process before invoking it via a new thread. The write can be performed with native Windows API calls such as <code>VirtualAllocEx</code> and <code>WriteProcessMemory</code>, then invoked with <code>CreateRemoteThread</code> or additional code (ex: shellcode). The displacement of the injected code does introduce the additional requirement for functionality to remap memory references.

Running code in the context of another process may allow access to the process's memory, system/network resources, and possibly elevated privileges. Execution via PE injection may also evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Portable Executable Injection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Portable Executable Injection
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Portable Executable Injection

This test injects a portable executable into a remote Notepad process memory using Portable Executable Injection and base-address relocation techniques. When successful, a message box will appear with the title "Warning" and the content "Atomic Red Team" after a few seconds.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Start-Process "#{exe_binary}"
Start-Sleep -Seconds 7
Get-Process -Name Notepad -ErrorAction SilentlyContinue | Stop-Process -Force
```

**Dependencies:**

- Portable Executable to inject must exist at specified location (#{exe_binary})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Portable Executable Injection by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1055.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process.

## Detection

### Behavioral Detection of PE Injection via Remote Memory Mapping

## Risk Assessment

| Finding                                            | Severity | Impact          |
| -------------------------------------------------- | -------- | --------------- |
| Portable Executable Injection technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [Atomic Red Team - T1055.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055.002)
- [MITRE ATT&CK - T1055.002](https://attack.mitre.org/techniques/T1055/002)
