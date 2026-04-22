---
name: "T1137.006_add-ins"
description: "Adversaries may abuse Microsoft Office add-ins to obtain persistence on a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1137.006
  - persistence
  - windows
  - office-suite
  - sub-technique
technique_id: "T1137.006"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1137/006"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-276
chains_with:
  - T1137
  - T1137.001
  - T1137.002
  - T1137.003
  - T1137.004
  - T1137.005
prerequisites:
  - T1137
severity_boost:
  T1137: "Chain with T1137 for deeper attack path"
  T1137.001: "Chain with T1137.001 for deeper attack path"
  T1137.002: "Chain with T1137.002 for deeper attack path"
---

# T1137.006 Add-ins

> **Sub-technique of:** T1137

## High-Level Description

Adversaries may abuse Microsoft Office add-ins to obtain persistence on a compromised system. Office add-ins can be used to add functionality to Office programs. There are different types of add-ins that can be used by the various Office products; including Word/Excel add-in Libraries (WLL/XLL), VBA add-ins, Office Component Object Model (COM) add-ins, automation add-ins, VBA Editor (VBE), Visual Studio Tools for Office (VSTO) add-ins, and Outlook add-ins. 

Add-ins can be used to obtain persistence because they can be set to execute code when an Office application starts.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Add-ins technique is applicable to target environment
- [ ] Check Windows systems for indicators of Add-ins
- [ ] Check Office Suite systems for indicators of Add-ins
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Code Executed Via Excel Add-in File (XLL)

Loads an XLL file using the excel add-ins library.
This causes excel to launch Notepad.exe as a child process. This atomic test does not include persistent code execution as you would typically see when this is implemented in malware.

**Supported Platforms:** windows

```powershell
$excelApp = New-Object -COMObject "Excel.Application"
if(-not $excelApp.path.contains("Program Files (x86)")){
    Write-Host "64-bit Office"
    $excelApp.RegisterXLL("PathToAtomicsFolder\T1137.006\bin\Addins\excelxll_x64.xll")
}
else{
  Write-Host "32-bit Office"
  $excelApp.RegisterXLL("PathToAtomicsFolder\T1137.006\bin\Addins\excelxll_x86.xll")
}
```

**Dependencies:**
- Microsoft Excel must be installed
- XLL files must exist on disk at specified location

### Atomic Test 2: Persistent Code Execution Via Excel Add-in File (XLL)

Creates an Excel Add-in file (XLL) and sets a registry key to make it run automatically when Excel is started
The sample XLL provided launches the notepad as a proof-of-concept for persistent execution from Office.

**Supported Platforms:** windows

```powershell
$excelApp = New-Object -COMObject "Excel.Application"
if(-not $excelApp.path.contains("Program Files (x86)")){
    Write-Host "64-bit Office"
    Copy "PathToAtomicsFolder\T1137.006\bin\Addins\excelxll_x64.xll" "$env:APPDATA\Microsoft\AddIns\notepad.xll"
}
else{
  Write-Host "32-bit Office"
  Copy "PathToAtomicsFolder\T1137.006\bin\Addins\excelxll_x86.xll" "$env:APPDATA\Microsoft\AddIns\notepad.xll"
}
$ver = $excelApp.version
$ExcelRegPath="HKCU:\Software\Microsoft\Office\$Ver\Excel\Options"
Remove-Item $ExcelRegPath -ErrorAction Ignore
New-Item -type Directory $ExcelRegPath | Out-Null
New-ItemProperty $ExcelRegPath OPEN -value "/R notepad.xll" -propertyType string | Out-Null
$excelApp.Quit()
Start-Process "Excel"
```

**Dependencies:**
- Microsoft Excel must be installed
- XLL files must exist on disk at specified location

### Atomic Test 3: Persistent Code Execution Via Word Add-in File (WLL)

Creates a Word Add-in file (WLL) which runs automatically when Word is started
The sample WLL provided launches the notepad as a proof-of-concept for persistent execution from Office.
Successfully tested on 32-bit Office 2016. Not successful from microsoft 365 version of Office.

**Supported Platforms:** windows

```powershell
$wdApp = New-Object -COMObject "Word.Application"
if(-not $wdApp.path.contains("Program Files (x86)"))  
{
  Write-Host "64-bit Office"
  Copy "PathToAtomicsFolder\T1137.006\bin\Addins\wordwll_x64.wll" "$env:APPDATA\Microsoft\Word\Startup\notepad.wll"        
}
else{
  Write-Host "32-bit Office"
  Copy "PathToAtomicsFolder\T1137.006\bin\Addins\wordwll_x86.wll" "$env:APPDATA\Microsoft\Word\Startup\notepad.wll"
}
Stop-Process -Name "WinWord" 
Start-Process "WinWord"
```

**Dependencies:**
- Microsoft Word must be installed
- WLL files must exist on disk at specified location

### Atomic Test 4: Persistent Code Execution Via Excel VBA Add-in File (XLAM)

Creates an Excel VBA Add-in file (XLAM) which runs automatically when Excel is started
The sample XLAM provided launches the notepad as a proof-of-concept for persistent execution from Office.

**Supported Platforms:** windows

```powershell
Copy "PathToAtomicsFolder\T1137.006\bin\Addins\ExcelVBAaddin.xlam" "$env:APPDATA\Microsoft\Excel\XLSTART\notepad.xlam"        
Start-Process "Excel"
```

**Dependencies:**
- Microsoft Excel must be installed
- XLAM file must exist on disk at specified location

### Atomic Test 5: Persistent Code Execution Via PowerPoint VBA Add-in File (PPAM)

Creates a PowerPoint VBA Add-in file (PPAM) which runs automatically when PowerPoint is started
The sample PPA provided launches the notepad as a proof-of-concept for persistent execution from Office.

**Supported Platforms:** windows

```powershell
Copy "PathToAtomicsFolder\T1137.006\bin\Addins\PptVBAaddin.ppam" "$env:APPDATA\Microsoft\Addins\notepad.ppam"
$ver = (New-Object -COMObject "PowerPoint.Application").version
$ExcelRegPath="HKCU:\Software\Microsoft\Office\$Ver\PowerPoint\AddIns\notepad"
New-Item -type Directory $ExcelRegPath -Force | Out-Null
New-ItemProperty $ExcelRegPath "Autoload" -value "1" -propertyType DWORD  | Out-Null
New-ItemProperty $ExcelRegPath "Path" -value "notepad.ppam" -propertyType string | Out-Null
Stop-Process -Name "PowerPnt" -ErrorAction Ignore
Start-Process "PowerPnt"
```

**Dependencies:**
- Microsoft Excel must be installed
- PPAM file must exist on disk at specified location


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Add-ins by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1137.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Office applications from creating child processes and from writing potentially malicious executable content to disk.


## Detection

### Detect Persistence via Malicious Office Add-ins


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Add-ins technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [FireEye Mail CDS 2018](https://web.archive.org/web/20190508170121/https://summit.fireeye.com/content/dam/fireeye-www/summit/cds-2018/presentations/cds18-technical-s03-youve-got-mail.pdf)
- [MRWLabs Office Persistence Add-ins](https://web.archive.org/web/20190526112859/https://labs.mwrinfosecurity.com/blog/add-in-opportunities-for-office-persistence/)
- [Microsoft Office Add-ins](https://support.office.com/article/Add-or-remove-add-ins-0af570c4-5cf3-4fa9-9b88-403625a0b460)
- [GlobalDotName Jun 2019](https://www.221bluestreet.com/post/office-templates-and-globaldotname-a-stealthy-office-persistence-technique)
- [Atomic Red Team - T1137.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1137.006)
- [MITRE ATT&CK - T1137.006](https://attack.mitre.org/techniques/T1137/006)
