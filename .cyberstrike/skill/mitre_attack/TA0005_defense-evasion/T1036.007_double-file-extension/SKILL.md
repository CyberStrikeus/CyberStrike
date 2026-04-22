---
name: "T1036.007_double-file-extension"
description: "Adversaries may abuse a double extension in the filename as a means of masquerading the true file type."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.007
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1036.007"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1036/007"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.003
  - T1036.004
  - T1036.005
  - T1036.006
  - T1036.008
  - T1036.009
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.007 Double File Extension

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may abuse a double extension in the filename as a means of masquerading the true file type. A file name may include a secondary file type extension that may cause only the first extension to be displayed (ex: <code>File.txt.exe</code> may render in some views as just <code>File.txt</code>). However, the second extension is the true file type that determines how the file is opened and executed. The real file extension may be hidden by the operating system in the file browser (ex: explorer.exe), as well as in any software configured using or similar to the system’s policies. 

Adversaries may abuse double extensions to attempt to conceal dangerous file types of payloads. A very common usage involves tricking a user into opening what they think is a benign file type but is actually executable code. Such files often pose as email attachments and allow an adversary to gain Initial Access into a user’s system via Spearphishing Attachment then User Execution. For example, an executable file attachment named <code>Evil.txt.exe</code> may display as <code>Evil.txt</code> to a user. The user may then view it as a benign text file and open it, inadvertently executing the hidden malware.

Common file types, such as text files (.txt, .doc, etc.) and image files (.jpg, .gif, etc.) are typically used as the first extension to appear benign. Executable extensions commonly regarded as dangerous, such as .exe, .lnk, .hta, and .scr, often appear as the second extension and true file type.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Double File Extension technique is applicable to target environment
- [ ] Check Windows systems for indicators of Double File Extension
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: File Extension Masquerading

download and execute a file masquerading as images or Office files. Upon execution 3 calc instances and 3 vbs windows will be launched.

e.g SOME_LEGIT_NAME.[doc,docx,xls,xlsx,pdf,rtf,png,jpg,etc.].[exe,vbs,js,ps1,etc] (Quartelyreport.docx.exe)

**Supported Platforms:** windows

```cmd
copy "#{exe_path}" %temp%\T1036.007_masquerading.docx.exe /Y
copy "#{exe_path}" %temp%\T1036.007_masquerading.pdf.exe /Y
copy "#{exe_path}" %temp%\T1036.007_masquerading.ps1.exe /Y
copy "#{vbs_path}" %temp%\T1036.007_masquerading.xls.vbs /Y
copy "#{vbs_path}" %temp%\T1036.007_masquerading.xlsx.vbs /Y
copy "#{vbs_path}" %temp%\T1036.007_masquerading.png.vbs /Y
copy "#{ps1_path}" %temp%\T1036.007_masquerading.doc.ps1 /Y
copy "#{ps1_path}" %temp%\T1036.007_masquerading.pdf.ps1 /Y
copy "#{ps1_path}" %temp%\T1036.007_masquerading.rtf.ps1 /Y
%temp%\T1036.007_masquerading.docx.exe
%temp%\T1036.007_masquerading.pdf.exe
%temp%\T1036.007_masquerading.ps1.exe
%temp%\T1036.007_masquerading.xls.vbs
%temp%\T1036.007_masquerading.xlsx.vbs
%temp%\T1036.007_masquerading.png.vbs
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -File %temp%\T1036.007_masquerading.doc.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -File %temp%\T1036.007_masquerading.pdf.ps1
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -File %temp%\T1036.007_masquerading.rtf.ps1
```

**Dependencies:**
- File to copy must exist on disk at specified location (#{vbs_path})
- File to copy must exist on disk at specified location (#{ps1_path})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Double File Extension by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1017 User Training
Train users to look for double extensions in filenames, and in general use training as a way to bring awareness to common phishing and spearphishing techniques and how to raise suspicion for potentially malicious events.

### M1028 Operating System Configuration
Disable the default to “hide file extensions for known file types” in Windows OS.


## Detection

### Detection Strategy for Double File Extension Masquerading


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Double File Extension technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [SOCPrime DoubleExtension](https://socprime.com/blog/rule-of-the-week-possible-malicious-file-double-extension/)
- [PCMag DoubleExtension](https://www.pcmag.com/encyclopedia/term/double-extension)
- [Seqrite DoubleExtension](https://www.seqrite.com/blog/how-to-avoid-dual-attack-and-vulnerable-files-with-double-extension/)
- [Atomic Red Team - T1036.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.007)
- [MITRE ATT&CK - T1036.007](https://attack.mitre.org/techniques/T1036/007)
