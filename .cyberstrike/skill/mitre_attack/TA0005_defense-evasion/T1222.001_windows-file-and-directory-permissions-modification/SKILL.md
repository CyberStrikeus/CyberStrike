---
name: "T1222.001_windows-file-and-directory-permissions-modification"
description: "Adversaries may modify file or directory permissions/attributes to evade access control lists (ACLs) and access protected files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1222.001
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1222.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1222/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1222
  - T1222.002
prerequisites:
  - T1222
severity_boost:
  T1222: "Chain with T1222 for deeper attack path"
  T1222.002: "Chain with T1222.002 for deeper attack path"
---

# T1222.001 Windows File and Directory Permissions Modification

> **Sub-technique of:** T1222

## High-Level Description

Adversaries may modify file or directory permissions/attributes to evade access control lists (ACLs) and access protected files. File and directory permissions are commonly managed by ACLs configured by the file or directory owner, or users with the appropriate permissions. File and directory ACL implementations vary by platform, but generally explicitly designate which users or groups can perform which actions (read, write, execute, etc.).

Windows implements file and directory ACLs as Discretionary Access Control Lists (DACLs). Similar to a standard ACL, DACLs identifies the accounts that are allowed or denied access to a securable object. When an attempt is made to access a securable object, the system checks the access control entries in the DACL in order. If a matching entry is found, access to the object is granted. Otherwise, access is denied.

Adversaries can interact with the DACLs using built-in Windows commands, such as `icacls`, `cacls`, `takeown`, and `attrib`, which can grant adversaries higher permissions on specific files and folders. Further, PowerShell provides cmdlets that can be used to retrieve or modify file and directory DACLs. Specific file and directory modifications may be a required step for many techniques, such as establishing Persistence via Accessibility Features, Boot or Logon Initialization Scripts, or tainting/hijacking other instrumental binary/configuration files via Hijack Execution Flow.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Windows File and Directory Permissions Modification technique is applicable to target environment
- [ ] Check Windows systems for indicators of Windows File and Directory Permissions Modification
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Take ownership using takeown utility

Modifies the filesystem permissions of the specified file or folder to take ownership of the object. Upon execution, "SUCCESS" will
be displayed for the folder and each file inside of it.

**Supported Platforms:** windows

```cmd
takeown.exe /f #{file_folder_to_own} /r
```

**Dependencies:**
- Test requrires a file to take ownership of to be located at (#{file_folder_to_own})

### Atomic Test 2: cacls - Grant permission to specified user or group recursively

Modifies the filesystem permissions of the specified folder and contents to allow the specified user or group Full Control. If "Access is denied"
is displayed it may be because the file or folder doesn't exit. Run the prereq command to create it. Upon successfull execution, "Successfully processed 3 files"
will be displayed.

**Supported Platforms:** windows

```cmd
icacls.exe #{file_or_folder} /grant #{user_or_group}:F
```

**Dependencies:**
- Test requrires a file to modify to be located at (#{file_or_folder})

### Atomic Test 3: attrib - Remove read-only attribute

Removes the read-only attribute from a file or folder using the attrib.exe command. Upon execution, no output will be displayed.
Open the file in File Explorer > Right Click - Prperties and observe that the Read Only checkbox is empty.

**Supported Platforms:** windows

```cmd
attrib.exe -r #{file_or_folder}\*.* /s
```

**Dependencies:**
- Test requrires a file to modify to be located at (#{file_or_folder})

### Atomic Test 4: attrib - hide file

Attackers leverage an existing Windows binary, attrib.exe, to mark specific files or folder as hidden by using specific flags so that
the victim does not see the file.

**Supported Platforms:** windows

```cmd
mkdir #{file_or_folder} >nul 2>&1
echo T1222.001_attrib1 >> #{file_or_folder}\T1222.001_attrib1.txt
echo T1222.001_attrib2 >> #{file_or_folder}\T1222.001_attrib2.txt
attrib.exe +h #{file_or_folder}\T1222.001_attrib1.txt
attrib.exe +h #{file_or_folder}\T1222.001_attrib2.txt
```

### Atomic Test 5: Grant Full Access to folder for Everyone - Ryuk Ransomware Style

Invokes the command line similar to that used by Ryuk Ransomware to grant full access to the entire C:\ drive for Everyone.
**icacls "C:\*" /grant Everyone:F /T /C /Q**
However, for this atomic we set the permission on C:\Users\Public so it completes faster and doesn't irreversibly affect the host.
You can set your own path variable to "C:\*" if you prefer.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
icacls "#{path}" /grant Everyone:F /T /C /Q
```

**Dependencies:**
- Backup of original folder permissions should exist (for use in cleanup commands)


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Windows File and Directory Permissions Modification by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1222.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management
Ensure critical system files as well as those known to be abused by adversaries have restrictive permissions and are owned by an appropriately privileged account, especially if access is not required by users nor will inhibit system functionality.

### M1022 Restrict File and Directory Permissions
Applying more restrictive permissions to files and directories could prevent adversaries from modifying the access control lists.


## Detection

### Windows DACL Manipulation Behavioral Chain Detection Strategy


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Windows File and Directory Permissions Modification technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Hybrid Analysis Icacls1 June 2018](https://www.hybrid-analysis.com/sample/ef0d2628823e8e0a0de3b08b8eacaf41cf284c086a948bdfd67f4e4373c14e4d?environmentId=100)
- [Hybrid Analysis Icacls2 May 2018](https://www.hybrid-analysis.com/sample/22dab012c3e20e3d9291bce14a2bfc448036d3b966c6e78167f4626f5f9e38d6?environmentId=110)
- [Microsoft Access Control Lists May 2018](https://docs.microsoft.com/en-us/windows/win32/secauthz/access-control-lists)
- [Microsoft DACL May 2018](https://docs.microsoft.com/windows/desktop/secauthz/dacls-and-aces)
- [EventTracker File Permissions Feb 2014](https://www.eventtracker.com/tech-articles/monitoring-file-permission-changes-windows-security-log/)
- [Atomic Red Team - T1222.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1222.001)
- [MITRE ATT&CK - T1222.001](https://attack.mitre.org/techniques/T1222/001)
