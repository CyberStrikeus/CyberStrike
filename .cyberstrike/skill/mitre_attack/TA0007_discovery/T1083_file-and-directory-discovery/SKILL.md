---
name: "T1083_file-and-directory-discovery"
description: "Adversaries may enumerate files and directories or may search in specific locations of a host or network share for certain information within a file system."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1083
  - discovery
  - esxi
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1083"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1083"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1083 File and Directory Discovery

## High-Level Description

Adversaries may enumerate files and directories or may search in specific locations of a host or network share for certain information within a file system. Adversaries may use the information from File and Directory Discovery during automated discovery to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions.

Many command shell utilities can be used to obtain this information. Examples include <code>dir</code>, <code>tree</code>, <code>ls</code>, <code>find</code>, and <code>locate</code>. Custom tools may also be used to gather file and directory information and interact with the Native API. Adversaries may also leverage a Network Device CLI on network devices to gather file and directory information (e.g. <code>dir</code>, <code>show flash</code>, and/or <code>nvram</code>).

Some files and directories may require elevated or specific user permissions to access.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if File and Directory Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of File and Directory Discovery
- [ ] Check Linux systems for indicators of File and Directory Discovery
- [ ] Check macOS systems for indicators of File and Directory Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: File and Directory Discovery (cmd.exe)

Find or discover files on the file system.  Upon successful execution, this test will output the results of all the data discovery commands to a specified file.

**Supported Platforms:** windows

```cmd
dir /s c:\ >> #{output_file}
dir /s "c:\Documents and Settings" >> #{output_file}
dir /s "c:\Program Files\" >> #{output_file}
dir "%systemdrive%\Users\*.*" >> #{output_file}
dir "%userprofile%\AppData\Roaming\Microsoft\Windows\Recent\*.*" >> #{output_file}
dir "%userprofile%\Desktop\*.*" >> #{output_file}
tree /F >> #{output_file}
```

### Atomic Test 2: File and Directory Discovery (PowerShell)

Find or discover files on the file system. Upon execution, file and folder information will be displayed.

**Supported Platforms:** windows

```powershell
ls -recurse
get-childitem -recurse
gci -recurse
```

### Atomic Test 3: Nix File and Directory Discovery

Find or discover files on the file system

References:

http://osxdaily.com/2013/01/29/list-all-files-subdirectory-contents-recursively/

https://perishablepress.com/list-files-folders-recursively-terminal/

**Supported Platforms:** linux, macos

```bash
ls -a >> #{output_file}
if [ -d /Library/Preferences/ ]; then ls -la /Library/Preferences/ > #{output_file}; fi;
file */* *>> #{output_file}
cat #{output_file} 2>/dev/null
find . -type f
ls -R | grep ":$" | sed -e 's/:$//' -e 's/[^-][^\/]*\//--/g' -e 's/^/ /' -e 's/-/|/'
locate *
which sh
```

### Atomic Test 4: Nix File and Directory Discovery 2

Find or discover files on the file system

**Supported Platforms:** linux, macos

```bash
cd $HOME && find . -print | sed -e 's;[^/]*/;|__;g;s;__|; |;g' > #{output_file}
if [ -f /etc/mtab ]; then cat /etc/mtab >> #{output_file}; fi;
find . -type f -iname *.pdf >> #{output_file}
cat #{output_file}
find . -type f -name ".*"
```

### Atomic Test 5: Simulating MAZE Directory Enumeration

This test emulates MAZE ransomware's ability to enumerate directories using Powershell.
Upon successful execution, this test will output the directory enumeration results to a specified file, as well as display them in the active window.
See https://www.mandiant.com/resources/tactics-techniques-procedures-associated-with-maze-ransomware-incidents

**Supported Platforms:** windows

```powershell
$folderarray = @("Desktop", "Downloads", "Documents", "AppData/Local", "AppData/Roaming")
Get-ChildItem -Path $env:homedrive -ErrorAction SilentlyContinue | Out-File -append #{File_to_output}
Get-ChildItem -Path $env:programfiles -erroraction silentlycontinue | Out-File -append #{File_to_output}
Get-ChildItem -Path "${env:ProgramFiles(x86)}" -erroraction silentlycontinue | Out-File -append #{File_to_output}
$UsersFolder = "$env:homedrive\Users\"
foreach ($directory in Get-ChildItem -Path $UsersFolder -ErrorAction SilentlyContinue)
{
foreach ($secondarydirectory in $folderarray)
 {Get-ChildItem -Path "$UsersFolder/$directory/$secondarydirectory" -ErrorAction SilentlyContinue | Out-File -append #{File_to_output}}
}
cat #{File_to_output}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to File and Directory Discovery by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1083 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Recursive Enumeration of Files and Directories Across Privilege Contexts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| File and Directory Discovery technique applicable | Medium | Discovery |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Windows Commands JPCERT](https://blogs.jpcert.or.jp/en/2016/01/windows-commands-abused-by-attackers.html)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1083](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1083)
- [MITRE ATT&CK - T1083](https://attack.mitre.org/techniques/T1083)
