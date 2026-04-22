---
name: "T1547.009_shortcut-modification"
description: "Adversaries may create or modify shortcuts that can execute a program during system boot or user login."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.009
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.009"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/009"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.009 Shortcut Modification

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may create or modify shortcuts that can execute a program during system boot or user login. Shortcuts or symbolic links are used to reference other files or programs that will be opened or executed when the shortcut is clicked or executed by a system startup process.

Adversaries may abuse shortcuts in the startup folder to execute their tools and achieve persistence. Although often used as payloads in an infection chain (e.g. Spearphishing Attachment), adversaries may also create a new shortcut as a means of indirection, while also abusing Masquerading to make the malicious shortcut appear as a legitimate program. Adversaries can also edit the target path or entirely replace an existing shortcut so their malware will be executed instead of the intended legitimate program.

Shortcuts can also be abused to establish persistence by implementing other methods. For example, LNK browser extensions may be modified (e.g. Browser Extensions) to persistently launch malware.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Shortcut Modification technique is applicable to target environment
- [ ] Check Windows systems for indicators of Shortcut Modification
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Shortcut Modification

This test to simulate shortcut modification and then execute. example shortcut (_.lnk , .url) strings check with powershell;
gci -path "C:\Users" -recurse -include _.url -ea SilentlyContinue | Select-String -Pattern "exe" | FL.
Upon execution, calc.exe will be launched.

**Supported Platforms:** windows

```cmd
echo [InternetShortcut] > #{shortcut_file_path}
echo URL=C:\windows\system32\calc.exe >> #{shortcut_file_path}
#{shortcut_file_path}
```

### Atomic Test 2: Create shortcut to cmd in startup folders

LNK file to launch CMD placed in startup folder. Upon execution, open File Explorer and browse to "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\"
to view the new shortcut.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$Shell = New-Object -ComObject ("WScript.Shell")
$ShortCut = $Shell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\T1547.009.lnk")
$ShortCut.TargetPath="cmd.exe"
$ShortCut.WorkingDirectory = "C:\Windows\System32";
$ShortCut.WindowStyle = 1;
$ShortCut.Description = "T1547.009.";
$ShortCut.Save()

$Shell = New-Object -ComObject ("WScript.Shell")
$ShortCut = $Shell.CreateShortcut("$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\T1547.009.lnk")
$ShortCut.TargetPath="cmd.exe"
$ShortCut.WorkingDirectory = "C:\Windows\System32";
$ShortCut.WindowStyle = 1;
$ShortCut.Description = "T1547.009.";
$ShortCut.Save()
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Shortcut Modification by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management

Limit Privileges for Shortcut Creation: While the SeCreateSymbolicLinkPrivilege is not directly related to .lnk file creation, you should still enforce least privilege principles by limiting user rights to create and modify shortcuts, especially in system-critical locations. This can be done through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Create symbolic links.

Regular User Permissions Review: Regularly review and audit user permissions to ensure that only necessary accounts have write access to startup folders and critical system directories.

### M1038 Execution Prevention

Prevents malicious shortcuts or LNK files from executing unwanted code by ensuring only authorized applications and scripts are allowed to run.

### M1022 Restrict File and Directory Permissions

Applying strict permissions to directories where shortcuts are stored, such as the startup folder, can prevent unauthorized modifications.

## Detection

### Detection Strategy for T1547.009 – Shortcut Modification (Windows)

## Risk Assessment

| Finding                                    | Severity | Impact      |
| ------------------------------------------ | -------- | ----------- |
| Shortcut Modification technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Shortcut for Persistence ](https://www.elastic.co/guide/en/security/7.17/shortcut-file-written-or-modified-for-persistence.html#shortcut-file-written-or-modified-for-persistence)
- [BSidesSLC 2020 - LNK Elastic](https://www.youtube.com/watch?v=nJ0UsyiUEqQ)
- [Atomic Red Team - T1547.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.009)
- [MITRE ATT&CK - T1547.009](https://attack.mitre.org/techniques/T1547/009)
