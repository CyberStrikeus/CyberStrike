---
name: "T1012_query-registry"
description: "Adversaries may interact with the Windows Registry to gather information about the system, configuration, and installed software."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1012
  - discovery
  - windows
technique_id: "T1012"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1012"
tech_stack:
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1012 Query Registry

## High-Level Description

Adversaries may interact with the Windows Registry to gather information about the system, configuration, and installed software.

The Registry contains a significant amount of information about the operating system, configuration, software, and security. Information can easily be queried using the Reg utility, though other means to access the Registry exist. Some of the information may help adversaries to further their operation within a network. Adversaries may use the information from Query Registry during automated discovery to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Windows

## What to Check

- [ ] Identify if Query Registry technique is applicable to target environment
- [ ] Check Windows systems for indicators of Query Registry
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Query Registry

Query Windows Registry.
Upon successful execution, cmd.exe will perform multiple reg queries. Some will succeed and others will fail (dependent upon OS).
References:
https://blog.cylance.com/windows-registry-persistence-part-2-the-run-keys-and-search-order
https://blog.cylance.com/windows-registry-persistence-part-1-introduction-attack-phases-and-windows-services
http://www.handgrep.se/repository/cheatsheets/postexploitation/WindowsPost-Exploitation.pdf
https://www.offensive-security.com/wp-content/uploads/2015/04/wp.Registry_Quick_Find_Chart.en_us.pdf

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows"
reg query HKLM\Software\Microsoft\Windows\CurrentVersion\RunServicesOnce
reg query HKCU\Software\Microsoft\Windows\CurrentVersion\RunServicesOnce
reg query HKLM\Software\Microsoft\Windows\CurrentVersion\RunServices
reg query HKCU\Software\Microsoft\Windows\CurrentVersion\RunServices
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Notify"
reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Userinit"
reg query "HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\\Shell"
reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\\Shell"
reg query HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\ShellServiceObjectDelayLoad
reg query HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce
reg query HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnceEx
reg query HKLM\Software\Microsoft\Windows\CurrentVersion\Run
reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run
reg query HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce
reg query HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run
reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run
reg query HKLM\system\currentcontrolset\services /s | findstr ImagePath 2>nul | findstr /Ri ".*\.sys$"
reg query HKLM\Software\Microsoft\Windows\CurrentVersion\Run
reg query HKLM\SYSTEM\CurrentControlSet\Control\SafeBoot
reg query "HKLM\SOFTWARE\Microsoft\Active Setup\Installed Components"
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\Scripts\Startup"
```

### Atomic Test 2: Query Registry with Powershell cmdlets

Query Windows Registry with Powershell cmdlets, i.e., Get-Item and Get-ChildItem. The results from above can also be achieved with Get-Item and Get-ChildItem.
Unlike using "reg query" which then executes reg.exe, using cmdlets won't generate new processes, which may evade detection systems monitoring process generation.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Get-Item -Path "HKLM:SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows"
Get-ChildItem -Path "HKLM:SOFTWARE\Microsoft\Windows NT\CurrentVersion\" | findstr Windows
Get-Item -Path "HKLM:Software\Microsoft\Windows\CurrentVersion\RunServicesOnce"
Get-Item -Path "HKCU:Software\Microsoft\Windows\CurrentVersion\RunServicesOnce"
Get-Item -Path "HKLM:Software\Microsoft\Windows\CurrentVersion\RunServices"
Get-Item -Path "HKCU:Software\Microsoft\Windows\CurrentVersion\RunServices"
Get-Item -Path "HKLM:SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Notify"
Get-Item -Path "HKLM:Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Userinit"
Get-Item -Path "HKCU:Software\Microsoft\Windows NT\CurrentVersion\Winlogon\\Shell"
Get-Item -Path "HKLM:Software\Microsoft\Windows NT\CurrentVersion\Winlogon\\Shell"
Get-Item -Path "HKLM:SOFTWARE\Microsoft\Windows\CurrentVersion\ShellServiceObjectDelayLoad"
Get-Item -Path "HKLM:Software\Microsoft\Windows\CurrentVersion\RunOnce"
Get-Item -Path "HKLM:Software\Microsoft\Windows\CurrentVersion\RunOnceEx"
Get-Item -Path "HKLM:Software\Microsoft\Windows\CurrentVersion\Run"
Get-Item -Path "HKCU:Software\Microsoft\Windows\CurrentVersion\Run"
Get-Item -Path "HKCU:Software\Microsoft\Windows\CurrentVersion\RunOnce"
Get-Item -Path "HKLM:Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run"
Get-Item -Path "HKCU:Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run"
Get-ChildItem -Path "HKLM:system\currentcontrolset\services"
Get-Item -Path "HKLM:Software\Microsoft\Windows\CurrentVersion\Run"
Get-Item -Path "HKLM:SYSTEM\CurrentControlSet\Control\SafeBoot"
Get-ChildItem -Path "HKLM:SOFTWARE\Microsoft\Active Setup\Installed Components"
Get-ChildItem -Path "HKLM:SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\Scripts\Startup"
```

### Atomic Test 3: Enumerate COM Objects in Registry with Powershell

This test is designed to enumerate the COM objects listed in HKCR, then output their methods and CLSIDs to a text file.
An adversary could then use this information to identify COM objects that might be vulnerable to abuse, such as using them to spawn arbitrary processes.
See: https://www.mandiant.com/resources/hunting-com-objects

**Supported Platforms:** windows

```powershell
New-PSDrive -PSProvider registry -Root HKEY_CLASSES_ROOT -Name HKCR
Get-ChildItem -Path HKCR:\CLSID -Name | Select -Skip 1 > $env:temp\clsids.txt
ForEach($CLSID in Get-Content "$env:temp\clsids.txt")
{try{write-output "$($Position)-$($CLSID)"
write-output "------------"| out-file #{output_file} -append
write-output $($CLSID)| out-file #{output_file} -append
$handle=[activator]::CreateInstance([type]::GetTypeFromCLSID($CLSID))
$handle | get-member -erroraction silentlycontinue | out-file #{output_file} -append
$position += 1} catch{}}
```

### Atomic Test 4: Reg query for AlwaysInstallElevated status

The reg query commands allows to check the status of the AlwaysInstallElevated registry key for both the user and the machine. If both queries return a value of 0x1, then AlwaysInstallElevated is enabled for both user and machine thus allowing a regular user to install a Microsoft Windows Installer package with system level privileges. This can be abused by an attacker to escalate privileges in the host to SYSTEM level.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
```

### Atomic Test 5: Check Software Inventory Logging (SIL) status via Registry

Microsoft's Software Inventory Logging (SIL) collects information about software installed per host basis. Adversary can use such logs to passively
check for existence of software of interest to them. Status of SIL can be checked via registry.
[Reference](https://blog.talosintelligence.com/chinese-hacking-group-apt41-compromised-taiwanese-government-affiliated-research-institute-with-shadowpad-and-cobaltstrike-2/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg.exe query hklm\software\microsoft\windows\softwareinventorylogging /v collectionstate /reg:64
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Query Registry by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Registry Query for Environmental Discovery

## Risk Assessment

| Finding                             | Severity | Impact    |
| ----------------------------------- | -------- | --------- |
| Query Registry technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Wikipedia Windows Registry](https://en.wikipedia.org/wiki/Windows_Registry)
- [Atomic Red Team - T1012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1012)
- [MITRE ATT&CK - T1012](https://attack.mitre.org/techniques/T1012)
