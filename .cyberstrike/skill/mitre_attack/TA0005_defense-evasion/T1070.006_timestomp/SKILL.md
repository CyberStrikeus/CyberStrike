---
name: "T1070.006_timestomp"
description: "Adversaries may modify file time attributes to hide new files or changes to existing files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1070.006
  - defense-evasion
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1070.006"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1070/006"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1070
  - T1070.001
  - T1070.002
  - T1070.003
  - T1070.004
  - T1070.005
  - T1070.007
  - T1070.008
  - T1070.009
  - T1070.010
prerequisites:
  - T1070
severity_boost:
  T1070: "Chain with T1070 for deeper attack path"
  T1070.001: "Chain with T1070.001 for deeper attack path"
  T1070.002: "Chain with T1070.002 for deeper attack path"
---

# T1070.006 Timestomp

> **Sub-technique of:** T1070

## High-Level Description

Adversaries may modify file time attributes to hide new files or changes to existing files. Timestomping is a technique that modifies the timestamps of a file (the modify, access, create, and change times), often to mimic files that are in the same folder and blend malicious files with legitimate files.

In Windows systems, both the `$STANDARD_INFORMATION` (`$SI`) and `$FILE_NAME` (`$FN`) attributes record times in a Master File Table (MFT) file. `$SI` (dates/time stamps) is displayed to the end user, including in the File System view, while `$FN` is dealt with by the kernel.

Modifying the `$SI` attribute is the most common method of timestomping because it can be modified at the user level using API calls. `$FN` timestomping, however, typically requires interacting with the system kernel or moving or renaming a file.

Adversaries modify timestamps on files so that they do not appear conspicuous to forensic investigators or file analysis tools. In order to evade detections that rely on identifying discrepancies between the `$SI` and `$FN` attributes, adversaries may also engage in “double timestomping” by modifying times on both attributes simultaneously.

In Linux systems and on ESXi servers, threat actors may attempt to perform timestomping using commands such as `touch -a -m -t <timestamp> <filename>` (which sets access and modification times to a specific value) or `touch -r <filename> <filename>` (which sets access and modification times to match those of another file).

Timestomping may be used along with file name Masquerading to hide malware and tools.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Timestomp technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Timestomp
- [ ] Check Linux systems for indicators of Timestomp
- [ ] Check macOS systems for indicators of Timestomp
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Set a file's access timestamp

Stomps on the access timestamp of a file

**Supported Platforms:** linux, macos

```bash
touch -a -t 197001010000.00 #{target_filename}
```

**Dependencies:**
- The file must exist in order to be timestomped

### Atomic Test 2: Set a file's modification timestamp

Stomps on the modification timestamp of a file

**Supported Platforms:** linux, macos

```bash
touch -m -t 197001010000.00 #{target_filename}
```

**Dependencies:**
- The file must exist in order to be timestomped

### Atomic Test 3: Set a file's creation timestamp

Stomps on the create timestamp of a file

Setting the creation timestamp requires changing the system clock and reverting.
Sudo or root privileges are required to change date. Use with caution.

**Supported Platforms:** linux, macos
**Elevation Required:** Yes

```bash
NOW=$(date +%m%d%H%M%Y)
date 010100001971
touch #{target_filename}
date "$NOW"
stat #{target_filename}
```

### Atomic Test 4: Modify file timestamps using reference file

Modifies the `modify` and `access` timestamps using the timestamps of a specified reference file.

This technique was used by the threat actor Rocke during the compromise of Linux web servers.

**Supported Platforms:** linux, macos

```bash
touch #{target_file_path}
touch -acmr #{reference_file_path} #{target_file_path}
```

### Atomic Test 5: Windows - Modify file creation timestamp with PowerShell

Modifies the file creation timestamp of a specified file. This technique was seen in use by the Stitch RAT.
To verify execution, use File Explorer to view the Properties of the file and observe that the Created time is the year 1970.

**Supported Platforms:** windows

```powershell
Get-ChildItem "#{file_path}" | % { $_.CreationTime = "#{target_date_time}" }
```

**Dependencies:**
- A file must exist at the path (#{file_path}) to change the creation time on


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Timestomp by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1070.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Cross-Platform Behavioral Detection of File Timestomping via Metadata Tampering


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Timestomp technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Juniper Networks ESXi Backdoor 2022](https://blogs.juniper.net/en-us/threat-research/a-custom-python-backdoor-for-vmware-esxi-servers)
- [WindowsIR Anti-Forensic Techniques](http://windowsir.blogspot.com/2013/07/howto-determinedetect-use-of-anti.html)
- [Inversecos Linux Timestomping](https://www.inversecos.com/2022/08/detecting-linux-anti-forensics.html)
- [Inversecos Timestomping 2022](https://www.inversecos.com/2022/04/defence-evasion-technique-timestomping.html)
- [Magnet Forensics](https://www.magnetforensics.com/blog/expose-evidence-of-timestomping-with-the-ntfs-timestamp-mismatch-artifact-in-magnet-axiom-4-4/)
- [Double Timestomping](https://x.com/matthewdunwoody/status/1519846657646604289)
- [Atomic Red Team - T1070.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1070.006)
- [MITRE ATT&CK - T1070.006](https://attack.mitre.org/techniques/T1070/006)
