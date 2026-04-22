---
name: "T1631.001_ptrace-system-calls"
description: "Adversaries may inject malicious code into processes via ptrace (process trace) system calls in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - mobile
  - t1631.001
  - defense-evasion
  - privilege-escalation
  - android
  - ios
  - sub-technique
technique_id: "T1631.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Android
  - iOS
mitre_url: "https://attack.mitre.org/techniques/T1631/001"
tech_stack:
  - android
  - ios
cwe_ids:
  - CWE-693
chains_with:
  - T1631
prerequisites:
  - T1631
severity_boost:
  T1631: "Chain with T1631 for deeper attack path"
---

# T1631.001 Ptrace System Calls

> **Sub-technique of:** T1631

## High-Level Description

Adversaries may inject malicious code into processes via ptrace (process trace) system calls in order to evade process-based defenses as well as possibly elevate privileges. Ptrace system call injection is a method of executing arbitrary code in the address space of a separate live process. 

Ptrace system call injection involves attaching to and modifying a running process. The ptrace system call enables a debugging process to observe and control another process (and each individual thread), including changing memory and register values. Ptrace system call injection is commonly performed by writing arbitrary code into a running process (e.g., by using `malloc`) then invoking that memory with `PTRACE_SETREGS` to set the register containing the next instruction to execute. Ptrace system call injection can also be done with `PTRACE_POKETEXT`/`PTRACE_POKEDATA`, which copy data to a specific address in the target process's memory (e.g., the current address of the next instruction). 

Ptrace system call injection may not be possible when targeting processes with high-privileges, and on some systems those that are non-child processes. 

Running code in the context of another process may allow access to the process's memory, system/network resources, and possibly elevated privileges. Execution via ptrace system call injection may also evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Defense Evasion (TA0030)
- Privilege Escalation (TA0029)

**Platforms:** Android, iOS

## What to Check

- [ ] Identify if Ptrace System Calls technique is applicable to target mobile environment
- [ ] Check Android devices for indicators of Ptrace System Calls
- [ ] Check iOS devices for indicators of Ptrace System Calls
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target mobile environment is susceptible to Ptrace System Calls by examining the target platforms (Android, iOS).

### Assess Existing Defenses

Review whether mitigations for T1631.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Ptrace System Calls


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Ptrace System Calls technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [BH Linux Inject](https://github.com/gaffe23/linux-inject/blob/master/slides_BHArsenal2015.pdf)
- [Medium Ptrace JUL 2018](https://medium.com/@jain.sm/code-injection-in-running-process-using-ptrace-d3ea7191a4be)
- [PTRACE man](http://man7.org/linux/man-pages/man2/ptrace.2.html)
- [MITRE ATT&CK Mobile - T1631.001](https://attack.mitre.org/techniques/T1631/001)
