---
name: "T1055.015_listplanting"
description: "Adversaries may abuse list-view controls to inject malicious code into hijacked processes in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055.015
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1055.015"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1055/015"
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
  - T1055.013
  - T1055.014
prerequisites:
  - T1055
severity_boost:
  T1055: "Chain with T1055 for deeper attack path"
  T1055.001: "Chain with T1055.001 for deeper attack path"
  T1055.002: "Chain with T1055.002 for deeper attack path"
---

# T1055.015 ListPlanting

> **Sub-technique of:** T1055

## High-Level Description

Adversaries may abuse list-view controls to inject malicious code into hijacked processes in order to evade process-based defenses as well as possibly elevate privileges. ListPlanting is a method of executing arbitrary code in the address space of a separate live process. Code executed via ListPlanting may also evade detection from security products since the execution is masked under a legitimate process.

List-view controls are user interface windows used to display collections of items. Information about an application's list-view settings are stored within the process' memory in a <code>SysListView32</code> control.

ListPlanting (a form of message-passing "shatter attack") may be performed by copying code into the virtual address space of a process that uses a list-view control then using that code as a custom callback for sorting the listed items. Adversaries must first copy code into the target process’ memory space, which can be performed various ways including by directly obtaining a handle to the <code>SysListView32</code> child of the victim process window (via Windows API calls such as <code>FindWindow</code> and/or <code>EnumWindows</code>) or other Process Injection methods.

Some variations of ListPlanting may allocate memory in the target process but then use window messages to copy the payload, to avoid the use of the highly monitored <code>WriteProcessMemory</code> function. For example, an adversary can use the <code>PostMessage</code> and/or <code>SendMessage</code> API functions to send <code>LVM_SETITEMPOSITION</code> and <code>LVM_GETITEMPOSITION</code> messages, effectively copying a payload 2 bytes at a time to the allocated memory. 

Finally, the payload is triggered by sending the <code>LVM_SORTITEMS</code> message to the <code>SysListView32</code> child of the process window, with the payload within the newly allocated buffer passed and executed as the <code>ListView_SortItems</code> callback.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if ListPlanting technique is applicable to target environment
- [ ] Check Windows systems for indicators of ListPlanting
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Process injection ListPlanting

This test injects shellcode into a remote RegEdit process using the ListPlanting technique. ListPlanting exploits Window with ListView control. Code write to memory with NtWriteVirtualMemory. The shellcode is executed via PostMessage. When successful, a message box will appear with the title "Warning" and the content "Atomic Red Team" after a few seconds. Notepad will open following the appearance of the message box.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Start-Process "#{exe_binary}"
Start-Sleep -Seconds 7
Get-Process -Name Notepad -ErrorAction SilentlyContinue | Stop-Process -Force
```

**Dependencies:**
- Injector ListPlanting.exe must exist at specified location (#{exe_binary})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to ListPlanting by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1055.015 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process.


## Detection

### Detection Strategy for ListPlanting Injection on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| ListPlanting technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Hexacorn Listplanting](https://www.hexacorn.com/blog/2019/04/25/listplanting-yet-another-code-injection-trick/)
- [ESET InvisiMole June 2020](https://www.welivesecurity.com/wp-content/uploads/2020/06/ESET_InvisiMole.pdf)
- [Microsoft List View Controls](https://docs.microsoft.com/windows/win32/controls/list-view-controls-overview)
- [Modexp Windows Process Injection](https://modexp.wordpress.com/2019/04/25/seven-window-injection-methods/)
- [Atomic Red Team - T1055.015](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055.015)
- [MITRE ATT&CK - T1055.015](https://attack.mitre.org/techniques/T1055/015)
