---
name: "T1553.005_mark-of-the-web-bypass"
description: "Adversaries may abuse specific file formats to subvert Mark-of-the-Web (MOTW) controls."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1553.005
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1553.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1553/005"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1553
  - T1553.001
  - T1553.002
  - T1553.003
  - T1553.004
  - T1553.006
prerequisites:
  - T1553
severity_boost:
  T1553: "Chain with T1553 for deeper attack path"
  T1553.001: "Chain with T1553.001 for deeper attack path"
  T1553.002: "Chain with T1553.002 for deeper attack path"
---

# T1553.005 Mark-of-the-Web Bypass

> **Sub-technique of:** T1553

## High-Level Description

Adversaries may abuse specific file formats to subvert Mark-of-the-Web (MOTW) controls. In Windows, when files are downloaded from the Internet, they are tagged with a hidden NTFS Alternate Data Stream (ADS) named <code>Zone.Identifier</code> with a specific value known as the MOTW. Files that are tagged with MOTW are protected and cannot perform certain actions. For example, starting in MS Office 10, if a MS Office file has the MOTW, it will open in Protected View. Executables tagged with the MOTW will be processed by Windows Defender SmartScreen that compares files with an allowlist of well-known executables. If the file is not known/trusted, SmartScreen will prevent the execution and warn the user not to run it.

Adversaries may abuse container files such as compressed/archive (.arj, .gzip) and/or disk image (.iso, .vhd) file formats to deliver malicious payloads that may not be tagged with MOTW. Container files downloaded from the Internet will be marked with MOTW but the files within may not inherit the MOTW after the container files are extracted and/or mounted. MOTW is a NTFS feature and many container files do not support NTFS alternative data streams. After a container file is extracted and/or mounted, the files contained within them may be treated as local files on disk and run without protections.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Mark-of-the-Web Bypass technique is applicable to target environment
- [ ] Check Windows systems for indicators of Mark-of-the-Web Bypass
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Mount ISO image

Mounts ISO image downloaded from internet to evade Mark-of-the-Web. Upon successful execution, powershell will download the .iso from the Atomic Red Team repo, and mount the image. The provided sample ISO simply has a Reports shortcut file in it. Reference: https://www.microsoft.com/security/blog/2021/05/27/new-sophisticated-email-based-attack-from-nobelium/

**Supported Platforms:** windows

```powershell
Mount-DiskImage -ImagePath "#{path_of_iso}"
```

**Dependencies:**

- T1553.005.iso must exist on disk at specified location (#{path_of_iso})

### Atomic Test 2: Mount an ISO image and run executable from the ISO

Mounts an ISO image downloaded from internet to evade Mark-of-the-Web and run hello.exe executable from the ISO.
Upon successful execution, powershell will download the .iso from the Atomic Red Team repo, mount the image, and run the executable from the ISO image that will open command prompt echoing "Hello, World!".
ISO provided by:https://twitter.com/mattifestation/status/1398323532988399620 Reference:https://www.microsoft.com/security/blog/2021/05/27/new-sophisticated-email-based-attack-from-nobelium/,

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Mount-DiskImage -ImagePath "#{path_of_iso}" -StorageType ISO -Access ReadOnly
$keep = Get-Volume -FileSystemLabel "TestIso"
$driveLetter = ($keep | Get-Volume).DriveLetter
invoke-item "$($driveLetter):\hello.exe"
```

**Dependencies:**

- FeelTheBurn.iso must exist on disk at specified location (#{path_of_iso})

### Atomic Test 3: Remove the Zone.Identifier alternate data stream

Remove the Zone.Identifier alternate data stream which identifies the file as downloaded from the internet.
Removing this allows more freedom in executing scripts in PowerShell and avoids opening files in protected view.

**Supported Platforms:** windows

```powershell
Unblock-File -Path #{file_path}
```

**Dependencies:**

- A test file with the Zone.Identifier attribute must be present.

### Atomic Test 4: Execute LNK file from ISO

Executes LNK file document.lnk from AllTheThings.iso. Link file executes cmd.exe and rundll32 to in order to load and execute AllTheThingsx64.dll from the ISO which spawns calc.exe.

**Supported Platforms:** windows

```powershell
Mount-DiskImage -ImagePath "#{path_of_iso}" -StorageType ISO -Access ReadOnly
$keep = Get-Volume -FileSystemLabel "AllTheThings"
$driveLetter = ($keep | Get-Volume).DriveLetter
$instance = [activator]::CreateInstance([type]::GetTypeFromCLSID("{c08afd90-f2a1-11d1-8455-00a0c91f3880}"))
$instance.Document.Application.ShellExecute($driveLetter+":\document.lnk","",$driveLetter+":\",$null,0)
```

**Dependencies:**

- AllTheThings.iso must exist on disk at specified location (#{path_of_iso})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Mark-of-the-Web Bypass by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1553.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Consider disabling auto-mounting of disk image files (i.e., .iso, .img, .vhd, and .vhdx). This can be achieved by modifying the Registry values related to the Windows Explorer file associations in order to disable the automatic Explorer "Mount and Burn" dialog for these file extensions. Note: this will not deactivate the mount functionality itself.

### M1038 Execution Prevention

Consider blocking container file types at web and/or email gateways. Consider unregistering container file extensions in Windows File Explorer.

## Detection

### Detect Mark-of-the-Web (MOTW) Bypass via Container and Disk Image Files

## Risk Assessment

| Finding                                     | Severity | Impact          |
| ------------------------------------------- | -------- | --------------- |
| Mark-of-the-Web Bypass technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Beek Use of VHD Dec 2020](https://web.archive.org/web/20201203131725/https://christiaanbeek.medium.com/investigating-the-use-of-vhd-files-by-cybercriminals-3f1f08304316)
- [Outflank MotW 2020](https://outflank.nl/blog/2020/03/30/mark-of-the-web-from-a-red-teams-perspective/)
- [Intezer Russian APT Dec 2020](https://www.intezer.com/blog/research/russian-apt-uses-covid-19-lures-to-deliver-zebrocy/)
- [Microsoft Zone.Identifier 2020](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-fscc/6e3f7352-d11c-4d76-8c39-2516a9df36e8)
- [Disable automount for ISO](https://gist.github.com/wdormann/fca29e0dcda8b5c0472e73e10c78c3e7)
- [Atomic Red Team - T1553.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1553.005)
- [MITRE ATT&CK - T1553.005](https://attack.mitre.org/techniques/T1553/005)
