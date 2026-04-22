---
name: "T1021.006_windows-remote-management"
description: "Adversaries may use Valid Accounts to interact with remote systems using Windows Remote Management (WinRM)."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021.006
  - lateral-movement
  - windows
  - sub-technique
technique_id: "T1021.006"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1021/006"
tech_stack:
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - T1021
  - T1021.001
  - T1021.002
  - T1021.003
  - T1021.004
  - T1021.005
  - T1021.007
  - T1021.008
prerequisites:
  - T1021
severity_boost:
  T1021: "Chain with T1021 for deeper attack path"
  T1021.001: "Chain with T1021.001 for deeper attack path"
  T1021.002: "Chain with T1021.002 for deeper attack path"
---

# T1021.006 Windows Remote Management

> **Sub-technique of:** T1021

## High-Level Description

Adversaries may use Valid Accounts to interact with remote systems using Windows Remote Management (WinRM). The adversary may then perform actions as the logged-on user.

WinRM is the name of both a Windows service and a protocol that allows a user to interact with a remote system (e.g., run an executable, modify the Registry, modify services). It may be called with the `winrm` command or by any number of programs such as PowerShell. WinRM can be used as a method of remotely interacting with Windows Management Instrumentation.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Windows

## What to Check

- [ ] Identify if Windows Remote Management technique is applicable to target environment
- [ ] Check Windows systems for indicators of Windows Remote Management
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Enable Windows Remote Management

Powershell Enable WinRM

Upon successful execution, powershell will "Enable-PSRemoting" allowing for remote PS access.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Enable-PSRemoting -Force
```

### Atomic Test 2: Remote Code Execution with PS Credentials Using Invoke-Command

Simulate lateral movement with PowerShell Remoting on the local host. 
Upon successful execution, PowerShell will execute `whoami` using `Invoke-Command`, targeting the 
local machine as remote target.

**Supported Platforms:** windows

```powershell
Enable-PSRemoting -Force
Invoke-Command -ComputerName $env:COMPUTERNAME -ScriptBlock {whoami}
```

### Atomic Test 3: WinRM Access with Evil-WinRM

An adversary may attempt to use Evil-WinRM with a valid account to interact with remote systems that have WinRM enabled

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
evil-winrm -i #{destination_address} -u #{user_name} -p #{password}
```

**Dependencies:**
- Computer must have Ruby Installed
- Computer must have Evil-WinRM installed


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Windows Remote Management by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1021.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
Disable the WinRM service.

### M1026 Privileged Account Management
If the service is necessary, lock down critical enclaves with separate WinRM accounts and permissions.

### M1030 Network Segmentation
If the service is necessary, lock down critical enclaves with separate WinRM infrastructure and follow WinRM best practices on use of host firewalls to restrict WinRM access to allow communication only to/from specific devices.


## Detection

### Behavioral Detection of WinRM-Based Remote Access


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Windows Remote Management technique applicable | Low | Lateral Movement |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [Medium Detecting Lateral Movement](https://medium.com/threatpunter/detecting-lateral-movement-using-sysmon-and-splunk-318d3be141bc)
- [Jacobsen 2014](https://www.slideshare.net/kieranjacobsen/lateral-movement-with-power-shell-2)
- [MSDN WMI](https://msdn.microsoft.com/en-us/library/aa394582.aspx)
- [Microsoft WinRM](https://learn.microsoft.com/en-us/windows/win32/winrm/portal)
- [Atomic Red Team - T1021.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021.006)
- [MITRE ATT&CK - T1021.006](https://attack.mitre.org/techniques/T1021/006)
