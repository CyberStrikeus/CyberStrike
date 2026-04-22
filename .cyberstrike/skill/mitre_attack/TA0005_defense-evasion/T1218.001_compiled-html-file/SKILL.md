---
name: "T1218.001_compiled-html-file"
description: "Adversaries may abuse Compiled HTML files (.chm) to conceal malicious code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.001
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.002
  - T1218.003
  - T1218.004
  - T1218.005
  - T1218.007
  - T1218.008
  - T1218.009
  - T1218.010
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
  T1218.003: "Chain with T1218.003 for deeper attack path"
---

# T1218.001 Compiled HTML File

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse Compiled HTML files (.chm) to conceal malicious code. CHM files are commonly distributed as part of the Microsoft HTML Help system. CHM files are compressed compilations of various content such as HTML documents, images, and scripting/web related programming languages such VBA, JScript, Java, and ActiveX. CHM content is displayed using underlying components of the Internet Explorer browser loaded by the HTML Help executable program (hh.exe).

A custom CHM file containing embedded payloads could be delivered to a victim then triggered by User Execution. CHM execution may also bypass application application control on older and/or unpatched systems that do not account for execution of binaries through hh.exe.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Compiled HTML File technique is applicable to target environment
- [ ] Check Windows systems for indicators of Compiled HTML File
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Compiled HTML Help Local Payload

Uses hh.exe to execute a local compiled HTML Help payload.
Upon execution calc.exe will open

**Supported Platforms:** windows

```cmd
hh.exe "#{local_chm_file}"
```

**Dependencies:**

- The payload must exist on disk at specified location (#{local_chm_file})

### Atomic Test 2: Compiled HTML Help Remote Payload

Uses hh.exe to execute a remote compiled HTML Help payload.
Upon execution displays an error saying the file cannot be open

**Supported Platforms:** windows

```cmd
hh.exe #{remote_chm_file}
```

### Atomic Test 3: Invoke CHM with default Shortcut Command Execution

Executes a CHM file with the default Shortcut Command method.

**Supported Platforms:** windows

```powershell
Invoke-ATHCompiledHelp -HHFilePath #{hh_file_path} -CHMFilePath #{chm_file_path}
```

**Dependencies:**

- The AtomicTestHarnesses module must be installed and Invoke-ATHCompiledHelp must be exported in the module.

### Atomic Test 4: Invoke CHM with InfoTech Storage Protocol Handler

Executes a CHM file with the ITS protocol handler.

**Supported Platforms:** windows

```powershell
Invoke-ATHCompiledHelp -InfoTechStorageHandler #{infotech_storage_handler} -HHFilePath #{hh_file_path} -CHMFilePath #{chm_file_path}
```

**Dependencies:**

- The AtomicTestHarnesses module must be installed and Invoke-ATHCompiledHelp must be exported in the module.

### Atomic Test 5: Invoke CHM Simulate Double click

Executes a CHM file simulating a user double click.

**Supported Platforms:** windows

```powershell
Invoke-ATHCompiledHelp -SimulateUserDoubleClick -CHMFilePath #{chm_file_path}
```

**Dependencies:**

- The AtomicTestHarnesses module must be installed and Invoke-ATHCompiledHelp must be exported in the module.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compiled HTML File by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1021 Restrict Web-Based Content

Consider blocking download/transfer and execution of potentially uncommon file types known to be used in adversary campaigns, such as CHM files

### M1038 Execution Prevention

Consider using application control to prevent execution of hh.exe if it is not required for a given system or network to prevent potential misuse by adversaries.

## Detection

### Detection of Suspicious Compiled HTML File Execution via hh.exe

## Risk Assessment

| Finding                                 | Severity | Impact          |
| --------------------------------------- | -------- | --------------- |
| Compiled HTML File technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Microsoft CVE-2017-8625 Aug 2017](https://portal.msrc.microsoft.com/en-US/security-guidance/advisory/CVE-2017-8625)
- [Microsoft HTML Help May 2018](https://docs.microsoft.com/previous-versions/windows/desktop/htmlhelp/microsoft-html-help-1-4-sdk)
- [Microsoft HTML Help Executable Program](https://msdn.microsoft.com/windows/desktop/ms524405)
- [Microsoft HTML Help ActiveX](https://msdn.microsoft.com/windows/desktop/ms644670)
- [MsitPros CHM Aug 2017](https://oddvar.moe/2017/08/13/bypassing-device-guard-umci-using-chm-cve-2017-8625/)
- [Atomic Red Team - T1218.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.001)
- [MITRE ATT&CK - T1218.001](https://attack.mitre.org/techniques/T1218/001)
