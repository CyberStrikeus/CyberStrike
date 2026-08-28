---
name: "T1222_file-and-directory-permissions-modification"
description: "Adversaries may modify file or directory permissions/attributes to evade access control lists (ACLs) and access protected files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1222
  - defense-evasion
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1222"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1222"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1222.001
  - T1222.002
prerequisites: []
severity_boost:
  T1222.001: "Chain with T1222.001 for deeper attack path"
  T1222.002: "Chain with T1222.002 for deeper attack path"
---

# T1222 File and Directory Permissions Modification

## High-Level Description

Adversaries may modify file or directory permissions/attributes to evade access control lists (ACLs) and access protected files. File and directory permissions are commonly managed by ACLs configured by the file or directory owner, or users with the appropriate permissions. File and directory ACL implementations vary by platform, but generally explicitly designate which users or groups can perform which actions (read, write, execute, etc.).

Modifications may include changing specific access rights, which may require taking ownership of a file or directory and/or elevated permissions depending on the file or directory’s existing permissions. This may enable malicious activity such as modifying, replacing, or deleting specific files or directories. Specific file and directory modifications may be a required step for many techniques, such as establishing Persistence via Accessibility Features, Boot or Logon Initialization Scripts, Unix Shell Configuration Modification, or tainting/hijacking other instrumental binary/configuration files via Hijack Execution Flow.

Adversaries may also change permissions of symbolic links. For example, malware (particularly ransomware) may modify symbolic links and associated settings to enable access to files from local shortcuts with remote paths.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if File and Directory Permissions Modification technique is applicable to target environment
- [ ] Check ESXi systems for indicators of File and Directory Permissions Modification
- [ ] Check Linux systems for indicators of File and Directory Permissions Modification
- [ ] Check macOS systems for indicators of File and Directory Permissions Modification
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Enable Local and Remote Symbolic Links via fsutil

Use fsutil to enable both ‘remote to local’ and ‘remote to remote’ symbolic links. This allows access to files from local shortcuts with local or remote paths.
[reference](https://symantec-enterprise-blogs.security.com/threat-intelligence/noberus-blackcat-alphv-rust-ransomware/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
fsutil behavior set SymlinkEvaluation R2L:1
fsutil behavior set SymlinkEvaluation R2R:1
```

### Atomic Test 2: Enable Local and Remote Symbolic Links via reg.exe

Use reg.exe to enable both ‘remote to local’ and ‘remote to remote’ symbolic links. This allows access to files from local shortcuts with local or remote paths.
[reference](https://symantec-enterprise-blogs.security.com/threat-intelligence/noberus-blackcat-alphv-rust-ransomware/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v SymlinkRemoteToLocalEvaluation /t REG_DWORD /d "1" /f
reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v SymlinkRemoteToRemoteEvaluation /t REG_DWORD /d "1" /f
```

### Atomic Test 3: Enable Local and Remote Symbolic Links via Powershell

Use Powershell to enable both ‘remote to local’ and ‘remote to remote’ symbolic links. This allows access to files from local shortcuts with local or remote paths.
[reference](https://symantec-enterprise-blogs.security.com/threat-intelligence/noberus-blackcat-alphv-rust-ransomware/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-ItemProperty -Path HKLM:\Software\Policies\Microsoft\Windows\Filesystems\NTFS -Name SymlinkRemoteToLocalEvaluation -PropertyType DWORD -Value 1 -Force -ErrorAction Ignore
New-ItemProperty -Path HKLM:\Software\Policies\Microsoft\Windows\Filesystems\NTFS -Name SymlinkRemoteToRemoteEvaluation -PropertyType DWORD -Value 1 -Force -ErrorAction Ignore
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to File and Directory Permissions Modification by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1222 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Applying more restrictive permissions to files and directories could prevent adversaries from modifying their access control lists. Additionally, ensure that user settings regarding local and remote symbolic links are properly set or disabled where unneeded.

### M1026 Privileged Account Management

Ensure critical system files as well as those known to be abused by adversaries have restrictive permissions and are owned by an appropriately privileged account, especially if access is not required by users nor will inhibit system functionality.

## Detection

### Multi-Platform File and Directory Permissions Modification Detection Strategy

## Risk Assessment

| Finding                                                          | Severity | Impact          |
| ---------------------------------------------------------------- | -------- | --------------- |
| File and Directory Permissions Modification technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [falconoverwatch_blackcat_attack](https://www.crowdstrike.com/blog/falcon-overwatch-contributes-to-blackcat-protection/)
- [Hybrid Analysis Icacls1 June 2018](https://www.hybrid-analysis.com/sample/ef0d2628823e8e0a0de3b08b8eacaf41cf284c086a948bdfd67f4e4373c14e4d?environmentId=100)
- [Hybrid Analysis Icacls2 May 2018](https://www.hybrid-analysis.com/sample/22dab012c3e20e3d9291bce14a2bfc448036d3b966c6e78167f4626f5f9e38d6?environmentId=110)
- [bad_luck_blackcat](https://go.kaspersky.com/rs/802-IJN-240/images/TR_BlackCat_Report.pdf)
- [fsutil_behavior](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/fsutil-behavior)
- [EventTracker File Permissions Feb 2014](https://www.eventtracker.com/tech-articles/monitoring-file-permission-changes-windows-security-log/)
- [blackmatter_blackcat](https://blog.talosintelligence.com/2022/03/from-blackmatter-to-blackcat-analyzing.html)
- [new_rust_based_ransomware](https://symantec-enterprise-blogs.security.com/blogs/threat-intelligence/noberus-blackcat-alphv-rust-ransomware)
- [Atomic Red Team - T1222](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1222)
- [MITRE ATT&CK - T1222](https://attack.mitre.org/techniques/T1222)
