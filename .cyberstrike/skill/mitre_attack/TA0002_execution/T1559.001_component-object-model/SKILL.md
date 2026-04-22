---
name: "T1559.001_component-object-model"
description: "Adversaries may use the Windows Component Object Model (COM) for local code execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1559.001
  - execution
  - windows
  - sub-technique
technique_id: "T1559.001"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1559/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1559
  - T1559.002
  - T1559.003
prerequisites:
  - T1559
severity_boost:
  T1559: "Chain with T1559 for deeper attack path"
  T1559.002: "Chain with T1559.002 for deeper attack path"
  T1559.003: "Chain with T1559.003 for deeper attack path"
---

# T1559.001 Component Object Model

> **Sub-technique of:** T1559

## High-Level Description

Adversaries may use the Windows Component Object Model (COM) for local code execution. COM is an inter-process communication (IPC) component of the native Windows application programming interface (API) that enables interaction between software objects, or executable code that implements one or more interfaces. Through COM, a client object can call methods of server objects, which are typically binary Dynamic Link Libraries (DLL) or executables (EXE). Remote COM execution is facilitated by Remote Services such as Distributed Component Object Model (DCOM).

Various COM interfaces are exposed that can be abused to invoke arbitrary execution via a variety of programming languages such as C, C++, Java, and Visual Basic. Specific COM objects also exist to directly perform functions beyond code execution, such as creating a Scheduled Task/Job, fileless download/execution, and other adversary behaviors related to privilege escalation and persistence.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Windows

## What to Check

- [ ] Identify if Component Object Model technique is applicable to target environment
- [ ] Check Windows systems for indicators of Component Object Model
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Component Object Model by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1559.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Modify Registry settings (directly or using Dcomcnfg.exe) in `HKEY_LOCAL_MACHINE\\SOFTWARE\\Classes\\AppID\\{AppID_GUID}` associated with the process-wide security of individual COM applications.

Modify Registry settings (directly or using Dcomcnfg.exe) in `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Ole` associated with system-wide security defaults for all COM applications that do no set their own process-wide security.

### M1048 Application Isolation and Sandboxing

Ensure all COM alerts and Protected View are enabled.

## Detection

### Detect Abuse of Component Object Model (T1559.001)

## Risk Assessment

| Finding                                     | Severity | Impact    |
| ------------------------------------------- | -------- | --------- |
| Component Object Model technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [ProjectZero File Write EoP Apr 2018](https://googleprojectzero.blogspot.com/2018/04/windows-exploitation-tricks-exploiting.html)
- [Fireeye Hunting COM June 2019](https://www.fireeye.com/blog/threat-research/2019/06/hunting-com-objects.html)
- [Microsoft COM](https://msdn.microsoft.com/library/windows/desktop/ms680573.aspx)
- [Enigma MMC20 COM Jan 2017](https://enigma0x3.net/2017/01/05/lateral-movement-using-the-mmc20-application-com-object/)
- [Enigma Outlook DCOM Lateral Movement Nov 2017](https://enigma0x3.net/2017/11/16/lateral-movement-using-outlooks-createobject-method-and-dotnettojscript/)
- [Atomic Red Team - T1559.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1559.001)
- [MITRE ATT&CK - T1559.001](https://attack.mitre.org/techniques/T1559/001)
