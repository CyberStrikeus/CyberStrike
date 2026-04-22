---
name: "T1134.004_parent-pid-spoofing"
description: "Adversaries may spoof the parent process identifier (PPID) of a new process to evade process-monitoring defenses or to elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1134.004
  - defense-evasion
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1134.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1134/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1134
  - T1134.001
  - T1134.002
  - T1134.003
  - T1134.005
prerequisites:
  - T1134
severity_boost:
  T1134: "Chain with T1134 for deeper attack path"
  T1134.001: "Chain with T1134.001 for deeper attack path"
  T1134.002: "Chain with T1134.002 for deeper attack path"
---

# T1134.004 Parent PID Spoofing

> **Sub-technique of:** T1134

## High-Level Description

Adversaries may spoof the parent process identifier (PPID) of a new process to evade process-monitoring defenses or to elevate privileges. New processes are typically spawned directly from their parent, or calling, process unless explicitly specified. One way of explicitly assigning the PPID of a new process is via the <code>CreateProcess</code> API call, which supports a parameter that defines the PPID to use. This functionality is used by Windows features such as User Account Control (UAC) to correctly set the PPID after a requested elevated process is spawned by SYSTEM (typically via <code>svchost.exe</code> or <code>consent.exe</code>) rather than the current user context.

Adversaries may abuse these mechanisms to evade defenses, such as those blocking processes spawning directly from Office documents, and analysis targeting unusual/potentially malicious parent-child process relationships, such as spoofing the PPID of PowerShell/Rundll32 to be <code>explorer.exe</code> rather than an Office document delivered as part of Spearphishing Attachment. This spoofing could be executed via Visual Basic within a malicious Office document or any code that can perform Native API.

Explicitly assigning the PPID may also enable elevated privileges given appropriate access rights to the parent process. For example, an adversary in a privileged user context (i.e. administrator) may spawn a new process and assign the parent as a process running as SYSTEM (such as <code>lsass.exe</code>), causing the new process to be elevated via the inherited access token.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Parent PID Spoofing technique is applicable to target environment
- [ ] Check Windows systems for indicators of Parent PID Spoofing
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Parent PID Spoofing using PowerShell

This test uses PowerShell to replicates how Cobalt Strike does ppid spoofing and masquerade a spawned process.
Upon execution, "Process C:\Program Files\Internet Explorer\iexplore.exe is spawned with pid ####" will be displayed and
calc.exe will be launched.

Credit to In Ming Loh (https://github.com/countercept/ppid-spoofing/blob/master/PPID-Spoof.ps1)

**Supported Platforms:** windows

```powershell
. "$PathToAtomicsFolder\T1134.004\src\PPID-Spoof.ps1"
$ppid=Get-Process #{parent_process_name} | select -expand id
PPID-Spoof -ppid $ppid -spawnto "#{spawnto_process_path}" -dllpath "#{dll_path}"
```

**Dependencies:**
- DLL to inject must exist on disk at specified location (#{dll_path})
- PPID.ps1 must exist on disk at $PathToAtomicsFolder\T1134.004\src\PPID-Spoof.ps1

### Atomic Test 2: Parent PID Spoofing - Spawn from Current Process

Spawns a powershell.exe process as a child of the current process.

**Supported Platforms:** windows

```powershell
Start-ATHProcessUnderSpecificParent -FilePath #{file_path} -CommandLine '#{command_line}' -ParentId #{parent_pid}
```

**Dependencies:**
- The AtomicTestHarnesses module must be installed and Start-ATHProcessUnderSpecificParent must be exported in the module.

### Atomic Test 3: Parent PID Spoofing - Spawn from Specified Process

Spawns a notepad.exe process as a child of the current process.

**Supported Platforms:** windows

```powershell
Start-ATHProcessUnderSpecificParent  -ParentId #{parent_pid} -TestGuid #{test_guid}
```

**Dependencies:**
- The AtomicTestHarnesses module must be installed and Start-ATHProcessUnderSpecificParent must be exported in the module.

### Atomic Test 4: Parent PID Spoofing - Spawn from svchost.exe

Spawnd a process as a child of the first accessible svchost.exe process.

**Supported Platforms:** windows

```powershell
Get-CimInstance -ClassName Win32_Process -Property Name, CommandLine, ProcessId -Filter "Name = 'svchost.exe' AND CommandLine LIKE '%'" | Select-Object -First 1 | Start-ATHProcessUnderSpecificParent -FilePath #{file_path} -CommandLine '#{command_line}'
```

**Dependencies:**
- The AtomicTestHarnesses module must be installed and Start-ATHProcessUnderSpecificParent must be exported in the module.

### Atomic Test 5: Parent PID Spoofing - Spawn from New Process

Creates a notepad.exe process and then spawns a powershell.exe process as a child of it.

**Supported Platforms:** windows

```powershell
Start-Process -FilePath #{parent_name} -PassThru | Start-ATHProcessUnderSpecificParent -FilePath #{file_path} -CommandLine '#{command_line}'
```

**Dependencies:**
- The AtomicTestHarnesses module must be installed and Start-ATHProcessUnderSpecificParent must be exported in the module.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Parent PID Spoofing by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1134.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Behavior-chain detection for T1134.004 Access Token Manipulation: Parent PID Spoofing (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Parent PID Spoofing technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [XPNSec PPID Nov 2017](https://blog.xpnsec.com/becoming-system/)
- [CounterCept PPID Spoofing Dec 2018](https://www.countercept.com/blog/detecting-parent-pid-spoofing/)
- [Microsoft UAC Nov 2018](https://docs.microsoft.com/windows/security/identity-protection/user-account-control/how-user-account-control-works)
- [Microsoft Process Creation Flags May 2018](https://docs.microsoft.com/windows/desktop/ProcThread/process-creation-flags)
- [Secuirtyinbits Ataware3 May 2019](https://www.securityinbits.com/malware-analysis/parent-pid-spoofing-stage-2-ataware-ransomware-part-3)
- [DidierStevens SelectMyParent Nov 2009](https://blog.didierstevens.com/2009/11/22/quickpost-selectmyparent-or-playing-with-the-windows-process-tree/)
- [CTD PPID Spoofing Macro Mar 2019](https://blog.christophetd.fr/building-an-office-macro-to-spoof-process-parent-and-command-line/)
- [Atomic Red Team - T1134.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1134.004)
- [MITRE ATT&CK - T1134.004](https://attack.mitre.org/techniques/T1134/004)
