---
name: "T1569.002_service-execution"
description: "Adversaries may abuse the Windows service control manager to execute malicious commands or payloads."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1569.002
  - execution
  - windows
  - sub-technique
technique_id: "T1569.002"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1569/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1569
  - T1569.001
  - T1569.003
prerequisites:
  - T1569
severity_boost:
  T1569: "Chain with T1569 for deeper attack path"
  T1569.001: "Chain with T1569.001 for deeper attack path"
  T1569.003: "Chain with T1569.003 for deeper attack path"
---

# T1569.002 Service Execution

> **Sub-technique of:** T1569

## High-Level Description

Adversaries may abuse the Windows service control manager to execute malicious commands or payloads. The Windows service control manager (<code>services.exe</code>) is an interface to manage and manipulate services. The service control manager is accessible to users via GUI components as well as system utilities such as <code>sc.exe</code> and Net.

PsExec can also be used to execute commands or payloads via a temporary Windows service created through the service control manager API. Tools such as PsExec and <code>sc.exe</code> can accept remote servers as arguments and may be used to conduct remote execution.

Adversaries may leverage these mechanisms to execute malicious content. This can be done by either executing a new or modified service. This technique is the execution used in conjunction with Windows Service during service persistence or privilege escalation.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Windows

## What to Check

- [ ] Identify if Service Execution technique is applicable to target environment
- [ ] Check Windows systems for indicators of Service Execution
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Execute a Command as a Service

Creates a service specifying an arbitrary command and executes it. When executing commands such as PowerShell, the service will report that it did not start correctly even when code executes properly.

Upon successful execution, cmd.exe creates a new service using sc.exe that will start powershell.exe to create a new file `art-marker.txt`

[BlackCat Ransomware (ALPHV)](https://www.varonis.com/blog/blackcat-ransomware)  
[Cybereason vs. BlackCat Ransomware](https://www.cybereason.com/blog/cybereason-vs.-blackcat-ransomware)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
sc.exe create #{service_name} binPath= "#{executable_command}"
sc.exe start #{service_name}
sc.exe delete #{service_name}
```

### Atomic Test 2: Use PsExec to execute a command on a remote host

Requires having Sysinternals installed, path to sysinternals is one of the input input_arguments
Will start a process on a remote host.

Upon successful execution, cmd will utilize psexec.exe to spawn calc.exe on a remote endpoint (default:localhost).

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\PsExec.exe" \\#{remote_host} -i -u #{user_name} -p #{password} -accepteula "C:\Windows\System32\calc.exe"
```

**Dependencies:**

- PsExec tool from Sysinternals must exist in the ExternalPayloads directory

### Atomic Test 4: BlackCat pre-encryption cmds with Lateral Movement

This atomic attempts to emulate the unique behavior of BlackCat ransomware prior to encryption and during Lateral Movement attempts via PsExec on Windows. Uses bundled PsExec like BlackCat

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
cmd.exe /c "wmic 	csproduct 	get UUID"
cmd.exe /c "fsutil behavior 	set SymlinkEvaluation R2L:1"
cmd.exe /c "fsutil behavior set 	SymlinkEvaluation R2R:1"
reg    add    HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters    /v MaxMpxCt /d 65535 /t REG_DWORD /f
copy "PathToAtomicsFolder\..\ExternalPayloads\PsExec.exe" $env:temp
cmd.exe /c "$env:temp\psexec.exe  -accepteula  \\#{targethost} cmd.exe  /c echo "--access-token""
```

**Dependencies:**

- PsExec must exist on disk at "PathToAtomicsFolder\..\ExternalPayloads\PsExec.exe"

### Atomic Test 5: Use RemCom to execute a command on a remote host

Requires having RemCom installed, path to RemCom is one of the input input_arguments
Will start a process on a remote host.
Upon successful execution, cmd will utilize RemCom.exe to spawn calc.exe on a remote endpoint (default:localhost).

**Supported Platforms:** windows

```cmd
"PathToAtomicsFolder\..\ExternalPayloads\remcom.exe" \\#{remote_host} /user:#{user_name} /pwd:#{password} cmd.exe
```

**Dependencies:**

- RemCom tool must exist on disk in the ExternalPayloads folder

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Service Execution by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1569.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Ensure that permissions disallow services that run at a higher permissions level from being created or interacted with by a user with a lower permission level.

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to block processes created by PsExec from running.

### M1022 Restrict File and Directory Permissions

Ensure that high permission level service binaries cannot be replaced or modified by users with a lower permission level.

## Detection

### Detection Strategy for System Services Service Execution

## Risk Assessment

| Finding                                | Severity | Impact    |
| -------------------------------------- | -------- | --------- |
| Service Execution technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Microsoft Service Control Manager](https://docs.microsoft.com/windows/win32/services/service-control-manager)
- [Russinovich Sysinternals](https://technet.microsoft.com/en-us/sysinternals/bb897553.aspx)
- [Atomic Red Team - T1569.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1569.002)
- [MITRE ATT&CK - T1569.002](https://attack.mitre.org/techniques/T1569/002)
