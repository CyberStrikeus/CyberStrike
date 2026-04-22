---
name: "T1564.003_hidden-window"
description: "Adversaries may use hidden windows to conceal malicious activity from the plain sight of users."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.003
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1564.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1564/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.001
  - T1564.002
  - T1564.004
  - T1564.005
  - T1564.006
  - T1564.007
  - T1564.008
  - T1564.009
  - T1564.010
  - T1564.011
  - T1564.012
  - T1564.013
  - T1564.014
prerequisites:
  - T1564
severity_boost:
  T1564: "Chain with T1564 for deeper attack path"
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.002: "Chain with T1564.002 for deeper attack path"
---

# T1564.003 Hidden Window

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may use hidden windows to conceal malicious activity from the plain sight of users. In some cases, windows that would typically be displayed when an application carries out an operation can be hidden. This may be utilized by system administrators to avoid disrupting user work environments when carrying out administrative tasks.

Adversaries may abuse these functionalities to hide otherwise visible windows from users so as not to alert the user to adversary activity on the system.

On macOS, the configurations for how applications run are listed in property list (plist) files. One of the tags in these files can be <code>apple.awt.UIElement</code>, which allows for Java applications to prevent the application's icon from appearing in the Dock. A common use for this is when applications run in the system tray, but don't also want to show up in the Dock.

Similarly, on Windows there are a variety of features in scripting languages, such as PowerShell, Jscript, and Visual Basic to make windows hidden. One example of this is <code>powershell.exe -WindowStyle Hidden</code>.

The Windows Registry can also be edited to hide application windows from the current user. For example, by setting the `WindowPosition` subkey in the `HKEY_CURRENT_USER\Console\%SystemRoot%_System32_WindowsPowerShell_v1.0_PowerShell.exe` Registry key to a maximum value, PowerShell windows will open off screen and be hidden.

In addition, Windows supports the `CreateDesktop()` API that can create a hidden desktop window with its own corresponding <code>explorer.exe</code> process. All applications running on the hidden desktop window, such as a hidden VNC (hVNC) session, will be invisible to other desktops windows.

Adversaries may also leverage cmd.exe as a parent process, and then utilize a LOLBin, such as DeviceCredentialDeployment.exe, to hide windows.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Hidden Window technique is applicable to target environment
- [ ] Check Linux systems for indicators of Hidden Window
- [ ] Check macOS systems for indicators of Hidden Window
- [ ] Check Windows systems for indicators of Hidden Window
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Hidden Window

Launch PowerShell with the "-WindowStyle Hidden" argument to conceal PowerShell windows by setting the WindowStyle parameter to hidden.
Upon execution a hidden PowerShell window will launch calc.exe

**Supported Platforms:** windows

```powershell
Start-Process #{powershell_command}
```

### Atomic Test 2: Headless Browser Accessing Mockbin

The following Atomic Red Team test leverages the Chrome headless browser to access a mockbin site. Create your own Mockbin.org site and replace the BIN in the inputs.
The default Mockbin ID forwards to google.com and you may view the details here https://mockbin.org/bin/f6b9a876-a826-4ac0-83b8-639d6ad516ec/view.
Reference: https://cert.gov.ua/article/5702579

**Supported Platforms:** windows

```cmd
start "" #{browser} --headless --disable-gpu https://mockbin.org/bin/#{bin_id}
```

### Atomic Test 3: Hidden Window-Conhost Execution

Launch conhost.exe in "headless" mode, it means that no visible window will pop up on the victim's machine.
This could be a sign of "conhost" usage as a LOLBIN or potential process injection activity.
conhost.exe can be used as proxy the execution of arbitrary commands

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
conhost.exe --headless calc.exe
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hidden Window by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Limit or restrict program execution using anti-virus software. On MacOS, allowlist programs that are allowed to have the plist tag. All other programs should be considered suspicious.

### M1033 Limit Software Installation

Restrict the installation of software that may be abused to create hidden desktops, such as hVNC, to user groups that require it.

## Detection

### Detection Strategy for Hidden Windows

## Risk Assessment

| Finding                            | Severity | Impact          |
| ---------------------------------- | -------- | --------------- |
| Hidden Window technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Cantoris Computing](https://cantoriscomputing.wordpress.com/2016/07/22/powershell-malware/)
- [Cybereason - Hidden Malicious Remote Access](https://www.cybereason.com/blog/behind-closed-doors-the-rise-of-hidden-malicious-remote-access)
- [LOLBAS Project GitHub Device Cred Dep](https://lolbas-project.github.io/lolbas/Binaries/DeviceCredentialDeployment/)
- [Hidden VNC](https://www.malwaretech.com/2015/09/hidden-vnc-for-beginners.html)
- [Anatomy of an hVNC Attack](https://securityintelligence.com/anatomy-of-an-hvnc-attack/)
- [SecureList BlueNoroff Device Cred Dev](https://securelist.com/bluenoroff-methods-bypass-motw/108383/)
- [Antiquated Mac Malware](https://blog.malwarebytes.com/threat-analysis/2017/01/new-mac-backdoor-using-antiquated-code/)
- [PowerShell About 2019](https://docs.microsoft.com/en-us/powershell/module/Microsoft.PowerShell.Core/About/about_PowerShell_exe?view=powershell-5.1)
- [Atomic Red Team - T1564.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.003)
- [MITRE ATT&CK - T1564.003](https://attack.mitre.org/techniques/T1564/003)
