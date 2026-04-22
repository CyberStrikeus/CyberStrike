---
name: "T1564.010_process-argument-spoofing"
description: "Adversaries may attempt to hide process command-line arguments by overwriting process memory."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.010
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1564.010"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1564/010"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.001
  - T1564.002
  - T1564.003
  - T1564.004
  - T1564.005
  - T1564.006
  - T1564.007
  - T1564.008
  - T1564.009
  - T1564.011
  - T1564.012
  - T1564.013
  - T1564.014
prerequisites:
  - T1564
severity_boost:
  T1564: "Chain with T1564 for deeper attack path"
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.002: "Chain with T1564.002 for deeper attack path"
---

# T1564.010 Process Argument Spoofing

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may attempt to hide process command-line arguments by overwriting process memory. Process command-line arguments are stored in the process environment block (PEB), a data structure used by Windows to store various information about/used by a process. The PEB includes the process command-line arguments that are referenced when executing the process. When a process is created, defensive tools/sensors that monitor process creations may retrieve the process arguments from the PEB.

Adversaries may manipulate a process PEB to evade defenses. For example, Process Hollowing can be abused to spawn a process in a suspended state with benign arguments. After the process is spawned and the PEB is initialized (and process information is potentially logged by tools/sensors), adversaries may override the PEB to modify the command-line arguments (ex: using the Native API <code>WriteProcessMemory()</code> function) then resume process execution with malicious arguments.

Adversaries may also execute a process with malicious command-line arguments then patch the memory with benign arguments that may bypass subsequent process memory analysis.

This behavior may also be combined with other tricks (such as Parent PID Spoofing) to manipulate or further evade process-based detections.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Process Argument Spoofing technique is applicable to target environment
- [ ] Check Windows systems for indicators of Process Argument Spoofing
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Process Argument Spoofing by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Process Argument Spoofing on Windows

## Risk Assessment

| Finding                                        | Severity | Impact          |
| ---------------------------------------------- | -------- | --------------- |
| Process Argument Spoofing technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft PEB 2021](https://docs.microsoft.com/en-us/windows/win32/api/winternl/ns-winternl-peb)
- [Xpn Argue Like Cobalt 2019](https://blog.xpnsec.com/how-to-argue-like-cobalt-strike/)
- [Cobalt Strike Arguments 2019](https://blog.cobaltstrike.com/2019/01/02/cobalt-strike-3-13-why-do-we-argue/)
- [Nviso Spoof Command Line 2020](https://blog.nviso.eu/2020/02/04/the-return-of-the-spoof-part-2-command-line-spoofing/)
- [FireEye FiveHands April 2021](https://www.fireeye.com/blog/threat-research/2021/04/unc2447-sombrat-and-fivehands-ransomware-sophisticated-financial-threat.html)
- [Mandiant Endpoint Evading 2019](https://www.mandiant.com/resources/staying-hidden-on-the-endpoint-evading-detection-with-shellcode)
- [Atomic Red Team - T1564.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.010)
- [MITRE ATT&CK - T1564.010](https://attack.mitre.org/techniques/T1564/010)
