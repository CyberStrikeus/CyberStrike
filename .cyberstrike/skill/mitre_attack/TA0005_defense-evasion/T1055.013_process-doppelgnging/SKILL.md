---
name: "T1055.013_process-doppelgnging"
description: "Adversaries may inject malicious code into process via process doppelgänging in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055.013
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1055.013"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1055/013"
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
  - T1055.011
  - T1055.012
  - T1055.014
  - T1055.015
prerequisites:
  - T1055
severity_boost:
  T1055: "Chain with T1055 for deeper attack path"
  T1055.001: "Chain with T1055.001 for deeper attack path"
  T1055.002: "Chain with T1055.002 for deeper attack path"
---

# T1055.013 Process Doppelgänging

> **Sub-technique of:** T1055

## High-Level Description

Adversaries may inject malicious code into process via process doppelgänging in order to evade process-based defenses as well as possibly elevate privileges. Process doppelgänging is a method of executing arbitrary code in the address space of a separate live process. 

Windows Transactional NTFS (TxF) was introduced in Vista as a method to perform safe file operations. To ensure data integrity, TxF enables only one transacted handle to write to a file at a given time. Until the write handle transaction is terminated, all other handles are isolated from the writer and may only read the committed version of the file that existed at the time the handle was opened. To avoid corruption, TxF performs an automatic rollback if the system or application fails during a write transaction. 

Although deprecated, the TxF application programming interface (API) is still enabled as of Windows 10. 

Adversaries may abuse TxF to a perform a file-less variation of Process Injection. Similar to Process Hollowing, process doppelgänging involves replacing the memory of a legitimate process, enabling the veiled execution of malicious code that may evade defenses and detection. Process doppelgänging's use of TxF also avoids the use of highly-monitored API functions such as <code>NtUnmapViewOfSection</code>, <code>VirtualProtectEx</code>, and <code>SetThreadContext</code>. 

Process Doppelgänging is implemented in 4 steps :

* Transact – Create a TxF transaction using a legitimate executable then overwrite the file with malicious code. These changes will be isolated and only visible within the context of the transaction.
* Load – Create a shared section of memory and load the malicious executable.
* Rollback – Undo changes to original executable, effectively removing malicious code from the file system.
* Animate – Create a process from the tainted section of memory and initiate execution.

This behavior will likely not result in elevated privileges since the injected process was spawned from (and thus inherits the security context) of the injecting process. However, execution via process doppelgänging may evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Process Doppelgänging technique is applicable to target environment
- [ ] Check Windows systems for indicators of Process Doppelgänging
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Process Doppelgänging by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1055.013 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process.


## Detection

### Detection Strategy for Process Doppelgänging on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Process Doppelgänging technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Microsoft TxF](https://msdn.microsoft.com/library/windows/desktop/bb968806.aspx)
- [Microsoft Basic TxF Concepts](https://msdn.microsoft.com/library/windows/desktop/dd979526.aspx)
- [Microsoft Where to use TxF](https://msdn.microsoft.com/library/windows/desktop/aa365738.aspx)
- [BlackHat Process Doppelgänging Dec 2017](https://www.blackhat.com/docs/eu-17/materials/eu-17-Liberman-Lost-In-Transaction-Process-Doppelganging.pdf)
- [hasherezade Process Doppelgänging Dec 2017](https://hshrzd.wordpress.com/2017/12/18/process-doppelganging-a-new-way-to-impersonate-a-process/)
- [Microsoft PsSetCreateProcessNotifyRoutine routine](https://msdn.microsoft.com/library/windows/hardware/ff559951.aspx)
- [Atomic Red Team - T1055.013](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055.013)
- [MITRE ATT&CK - T1055.013](https://attack.mitre.org/techniques/T1055/013)
