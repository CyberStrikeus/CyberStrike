---
name: "T1137.002_office-test"
description: "Adversaries may abuse the Microsoft Office \"Office Test\" Registry key to obtain persistence on a compromised system."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1137.002
  - persistence
  - windows
  - office-suite
  - sub-technique
technique_id: "T1137.002"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1137/002"
tech_stack:
  - windows
  - office
cwe_ids:
  - CWE-276
chains_with:
  - T1137
  - T1137.001
  - T1137.003
  - T1137.004
  - T1137.005
  - T1137.006
prerequisites:
  - T1137
severity_boost:
  T1137: "Chain with T1137 for deeper attack path"
  T1137.001: "Chain with T1137.001 for deeper attack path"
  T1137.003: "Chain with T1137.003 for deeper attack path"
---

# T1137.002 Office Test

> **Sub-technique of:** T1137

## High-Level Description

Adversaries may abuse the Microsoft Office "Office Test" Registry key to obtain persistence on a compromised system. An Office Test Registry location exists that allows a user to specify an arbitrary DLL that will be executed every time an Office application is started. This Registry key is thought to be used by Microsoft to load DLLs for testing and debugging purposes while developing Office applications. This Registry key is not created by default during an Office installation.

There exist user and global Registry keys for the Office Test feature, such as:

* <code>HKEY_CURRENT_USER\Software\Microsoft\Office test\Special\Perf</code>
* <code>HKEY_LOCAL_MACHINE\Software\Microsoft\Office test\Special\Perf</code>

Adversaries may add this Registry key and specify a malicious DLL that will be executed whenever an Office application, such as Word or Excel, is started.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows, Office Suite

## What to Check

- [ ] Identify if Office Test technique is applicable to target environment
- [ ] Check Windows systems for indicators of Office Test
- [ ] Check Office Suite systems for indicators of Office Test
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Office Application Startup Test Persistence (HKCU)

Office Test Registry location exists that allows a user to specify an arbitrary DLL that will be executed every time an Office
application is started. Key is used for debugging purposes. Not created by default & exist in HKCU & HKLM hives.

**Supported Platforms:** windows

```powershell
$wdApp = New-Object -COMObject "Word.Application"
if(-not $wdApp.path.contains("Program Files (x86)"))  
{
  Write-Host "64-bit Office"
  reg add "HKEY_CURRENT_USER\Software\Microsoft\Office test\Special\Perf" /t REG_SZ /d "PathToAtomicsFolder\T1137.002\bin\officetest_x64.dll" /f       
}
else{
  Write-Host "32-bit Office"
  reg add "HKEY_CURRENT_USER\Software\Microsoft\Office test\Special\Perf" /t REG_SZ /d "PathToAtomicsFolder\T1137.002\bin\officetest_x86.dll" /f
}
Stop-Process -Name "WinWord" 
Start-Process "WinWord"
```

**Dependencies:**
- Microsoft Word must be installed
- DLL files must exist on disk at specified location


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Office Test by examining the target platforms (Windows, Office Suite).

2. **Assess Existing Defenses**: Review whether mitigations for T1137.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1054 Software Configuration
Create the Registry key used to execute it and set the permissions to "Read Control" to prevent easy access to the key without administrator permissions or requiring Privilege Escalation.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent Office applications from creating child processes and from writing potentially malicious executable content to disk.


## Detection

### Detect Persistence via Office Test Registry DLL Injection


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Office Test technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Palo Alto Office Test Sofacy](https://researchcenter.paloaltonetworks.com/2016/07/unit42-technical-walkthrough-office-test-persistence-method-used-in-recent-sofacy-attacks/)
- [Hexacorn Office Test](http://www.hexacorn.com/blog/2014/04/16/beyond-good-ol-run-key-part-10/)
- [Atomic Red Team - T1137.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1137.002)
- [MITRE ATT&CK - T1137.002](https://attack.mitre.org/techniques/T1137/002)
