---
name: "T1055.011_extra-window-memory-injection"
description: "Adversaries may inject malicious code into process via Extra Window Memory (EWM) in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055.011
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1055.011"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1055/011"
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

# T1055.011 Extra Window Memory Injection

> **Sub-technique of:** T1055

## High-Level Description

Adversaries may inject malicious code into process via Extra Window Memory (EWM) in order to evade process-based defenses as well as possibly elevate privileges. EWM injection is a method of executing arbitrary code in the address space of a separate live process.

Before creating a window, graphical Windows-based processes must prescribe to or register a windows class, which stipulate appearance and behavior (via windows procedures, which are functions that handle input/output of data). Registration of new windows classes can include a request for up to 40 bytes of EWM to be appended to the allocated memory of each instance of that class. This EWM is intended to store data specific to that window and has specific application programming interface (API) functions to set and get its value.

Although small, the EWM is large enough to store a 32-bit pointer and is often used to point to a windows procedure. Malware may possibly utilize this memory location in part of an attack chain that includes writing code to shared sections of the process’s memory, placing a pointer to the code in EWM, then invoking execution by returning execution control to the address in the process’s EWM.

Execution granted through EWM injection may allow access to both the target process's memory and possibly elevated privileges. Writing payloads to shared sections also avoids the use of highly monitored API calls such as <code>WriteProcessMemory</code> and <code>CreateRemoteThread</code>. More sophisticated malware samples may also potentially bypass protection mechanisms such as data execution prevention (DEP) by triggering a combination of windows procedures and other system functions that will rewrite the malicious payload inside an executable portion of the target process.

Running code in the context of another process may allow access to the process's memory, system/network resources, and possibly elevated privileges. Execution via EWM injection may also evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Extra Window Memory Injection technique is applicable to target environment
- [ ] Check Windows systems for indicators of Extra Window Memory Injection
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Process Injection via Extra Window Memory (EWM) x64 executable

Hooks functions of main process to inject a payload via Extra Window Memory (EWM) injection technique

**Supported Platforms:** windows

```powershell
#{exe_binary}
```

**Dependencies:**

- T1055.011x64.exe and payload must exist on disk at specified location (#{exe_binary} and #{payload_file})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Extra Window Memory Injection by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1055.011 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process.

## Detection

### Detection Strategy for Extra Window Memory (EWM) Injection on Windows

## Risk Assessment

| Finding                                            | Severity | Impact          |
| -------------------------------------------------- | -------- | --------------- |
| Extra Window Memory Injection technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft Window Classes](https://msdn.microsoft.com/library/windows/desktop/ms633574.aspx)
- [Microsoft GetWindowLong function](https://msdn.microsoft.com/library/windows/desktop/ms633584.aspx)
- [Microsoft SetWindowLong function](https://msdn.microsoft.com/library/windows/desktop/ms633591.aspx)
- [Elastic Process Injection July 2017](https://www.endgame.com/blog/technical-blog/ten-process-injection-techniques-technical-survey-common-and-trending-process)
- [MalwareTech Power Loader Aug 2013](https://www.malwaretech.com/2013/08/powerloader-injection-something-truly.html)
- [WeLiveSecurity Gapz and Redyms Mar 2013](https://www.welivesecurity.com/2013/03/19/gapz-and-redyms-droppers-based-on-power-loader-code/)
- [Microsoft SendNotifyMessage function](https://msdn.microsoft.com/library/windows/desktop/ms644953.aspx)
- [Atomic Red Team - T1055.011](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055.011)
- [MITRE ATT&CK - T1055.011](https://attack.mitre.org/techniques/T1055/011)
