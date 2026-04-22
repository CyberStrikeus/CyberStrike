---
name: "T1560.001_archive-via-utility"
description: "Adversaries may use utilities to compress and/or encrypt collected data prior to exfiltration."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1560.001
  - collection
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1560.001"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1560/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1560
  - T1560.002
  - T1560.003
prerequisites:
  - T1560
severity_boost:
  T1560: "Chain with T1560 for deeper attack path"
  T1560.002: "Chain with T1560.002 for deeper attack path"
  T1560.003: "Chain with T1560.003 for deeper attack path"
---

# T1560.001 Archive via Utility

> **Sub-technique of:** T1560

## High-Level Description

Adversaries may use utilities to compress and/or encrypt collected data prior to exfiltration. Many utilities include functionalities to compress, encrypt, or otherwise package data into a format that is easier/more secure to transport.

Adversaries may abuse various utilities to compress or encrypt data before exfiltration. Some third party utilities may be preinstalled, such as <code>tar</code> on Linux and macOS or <code>zip</code> on Windows systems.

On Windows, <code>diantz</code> or <code> makecab</code> may be used to package collected files into a cabinet (.cab) file. <code>diantz</code> may also be used to download and compress files from remote locations (i.e. Remote Data Staging). <code>xcopy</code> on Windows can copy files and directories with a variety of options. Additionally, adversaries may use certutil to Base64 encode collected data before exfiltration.

Adversaries may use also third party utilities, such as 7-Zip, WinRAR, and WinZip, to perform similar activities.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Archive via Utility technique is applicable to target environment
- [ ] Check Linux systems for indicators of Archive via Utility
- [ ] Check macOS systems for indicators of Archive via Utility
- [ ] Check Windows systems for indicators of Archive via Utility
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Compress Data for Exfiltration With Rar

An adversary may compress data (e.g., sensitive documents) that is collected prior to exfiltration.
When the test completes you should find the txt files from the %USERPROFILE% directory compressed in a file called T1560.001-data.rar in the %USERPROFILE% directory

**Supported Platforms:** windows

```cmd
"#{rar_exe}" a -r #{output_file} #{input_path}\*#{file_extension}
```

**Dependencies:**

- Rar tool must be installed at specified location (#{rar_exe})

### Atomic Test 2: Compress Data and lock with password for Exfiltration with winrar

Note: Requires winrar installation
rar a -p"blue" hello.rar (VARIANT)

**Supported Platforms:** windows

```cmd
mkdir .\tmp\victim-files
cd .\tmp\victim-files
echo "This file will be encrypted" > .\encrypted_file.txt
"#{rar_exe}" a -hp"blue" hello.rar
dir
```

**Dependencies:**

- Rar tool must be installed at specified location (#{rar_exe})

### Atomic Test 3: Compress Data and lock with password for Exfiltration with winzip

Note: Requires winzip installation
wzzip sample.zip -s"blueblue" \*.txt (VARIANT)

**Supported Platforms:** windows

```cmd
path=%path%;"C:\Program Files (x86)\winzip"
mkdir .\tmp\victim-files
cd .\tmp\victim-files
echo "This file will be encrypted" > .\encrypted_file.txt
"#{winzip_exe}" -min -a -s"hello" archive.zip *
dir
```

**Dependencies:**

- Winzip must be installed

### Atomic Test 4: Compress Data and lock with password for Exfiltration with 7zip

Note: This test requires 7zip installation

**Supported Platforms:** windows

```cmd
mkdir $PathToAtomicsFolder\T1560.001\victim-files
cd $PathToAtomicsFolder\T1560.001\victim-files
echo "This file will be encrypted" > .\encrypted_file.txt
"#{7zip_exe}" u archive.7z *txt -pblue
dir
```

**Dependencies:**

- 7zip tool must be installed at specified location (#{7zip_exe})

### Atomic Test 5: Data Compressed - nix - zip

An adversary may compress data (e.g., sensitive documents) that is collected prior to exfiltration. This test uses standard zip compression.

**Supported Platforms:** linux, macos
**Elevation Required:** Yes

```bash
zip #{output_file} #{input_files}
```

**Dependencies:**

- Files to zip must exist (#{input_files})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Archive via Utility by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1560.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

System scans can be performed to identify unauthorized archival utilities.

## Detection

### Detect Archiving via Utility (T1560.001)

## Risk Assessment

| Finding                                  | Severity | Impact     |
| ---------------------------------------- | -------- | ---------- |
| Archive via Utility technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [WinRAR Homepage](https://www.rarlab.com/)
- [WinZip Homepage](https://www.winzip.com/win/en/)
- [7zip Homepage](https://www.7-zip.org/)
- [diantz.exe_lolbas](https://lolbas-project.github.io/lolbas/Binaries/Diantz/)
- [Wikipedia File Header Signatures](https://en.wikipedia.org/wiki/List_of_file_signatures)
- [Atomic Red Team - T1560.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1560.001)
- [MITRE ATT&CK - T1560.001](https://attack.mitre.org/techniques/T1560/001)
