---
name: "T1564.001_hidden-files-and-directories"
description: "Adversaries may set files and directories to be hidden to evade detection mechanisms."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.001
  - defense-evasion
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1564.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1564/001"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.002
  - T1564.003
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
  T1564.002: "Chain with T1564.002 for deeper attack path"
  T1564.003: "Chain with T1564.003 for deeper attack path"
---

# T1564.001 Hidden Files and Directories

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may set files and directories to be hidden to evade detection mechanisms. To prevent normal users from accidentally changing special files on a system, most operating systems have the concept of a ‘hidden’ file. These files don’t show up when a user browses the file system with a GUI or when using normal commands on the command line. Users must explicitly ask to show the hidden files either via a series of Graphical User Interface (GUI) prompts or with command line switches (<code>dir /a</code> for Windows and <code>ls –a</code> for Linux and macOS).

On Linux and Mac, users can mark specific files as hidden simply by putting a “.” as the first character in the file or folder name . Files and folders that start with a period, ‘.’, are by default hidden from being viewed in the Finder application and standard command-line utilities like “ls”. Users must specifically change settings to have these files viewable.

Files on macOS can also be marked with the UF_HIDDEN flag which prevents them from being seen in Finder.app, but still allows them to be seen in Terminal.app . On Windows, users can mark specific files as hidden by using the attrib.exe binary. Many applications create these hidden files and folders to store information so that it doesn’t clutter up the user’s workspace. For example, SSH utilities create a .ssh folder that’s hidden and contains the user’s known hosts and keys.

Additionally, adversaries may name files in a manner that would allow the file to be hidden such as naming a file only a “space” character.

Adversaries can use this to their advantage to hide files and folders anywhere on the system and evading a typical user or system analysis that does not incorporate investigation of hidden files.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Hidden Files and Directories technique is applicable to target environment
- [ ] Check Linux systems for indicators of Hidden Files and Directories
- [ ] Check Windows systems for indicators of Hidden Files and Directories
- [ ] Check macOS systems for indicators of Hidden Files and Directories
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create a hidden file in a hidden directory

Creates a hidden file inside a hidden directory

**Supported Platforms:** linux, macos

```bash
mkdir /var/tmp/.hidden-directory
echo "T1564.001" > /var/tmp/.hidden-directory/.hidden-file
```

### Atomic Test 2: Mac Hidden file

Hide a file on MacOS

**Supported Platforms:** macos

```bash
xattr -lr * / 2>&1 /dev/null | grep -C 2 "00 00 00 00 00 00 00 00 40 00 FF FF FF FF 00 00"
```

### Atomic Test 3: Create Windows System File with Attrib

Creates a file and marks it as a system file using the attrib.exe utility. Upon execution, open the file in file explorer then open Properties > Details
and observe that the Attributes are "SA" for System and Archive.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
attrib.exe +s #{file_to_modify}
```

**Dependencies:**
- The file must exist on disk at specified location (#{file_to_modify})

### Atomic Test 4: Create Windows Hidden File with Attrib

Creates a file and marks it as hidden using the attrib.exe utility.Upon execution, open File Epxplorer and enable View > Hidden Items. Then, open Properties > Details on the file
and observe that the Attributes are "SH" for System and Hidden.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
attrib.exe +h #{file_to_modify}
```

**Dependencies:**
- The file must exist on disk at specified location (#{file_to_modify})

### Atomic Test 5: Hidden files

Requires Apple Dev Tools

**Supported Platforms:** macos

```bash
setfile -a V #{filename}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hidden Files and Directories by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Hidden Files and Directories


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Hidden Files and Directories technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [WireLurker](https://www.paloaltonetworks.com/content/dam/pan/en_US/assets/pdf/reports/Unit_42/unit42-wirelurker.pdf)
- [Sofacy Komplex Trojan](https://researchcenter.paloaltonetworks.com/2016/09/unit42-sofacys-komplex-os-x-trojan/)
- [Antiquated Mac Malware](https://blog.malwarebytes.com/threat-analysis/2017/01/new-mac-backdoor-using-antiquated-code/)
- [Atomic Red Team - T1564.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.001)
- [MITRE ATT&CK - T1564.001](https://attack.mitre.org/techniques/T1564/001)
