---
name: "T1505.005_terminal-services-dll"
description: "Adversaries may abuse components of Terminal Services to enable persistent access to systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1505.005
  - persistence
  - windows
  - sub-technique
technique_id: "T1505.005"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1505/005"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1505
  - T1505.001
  - T1505.002
  - T1505.003
  - T1505.004
  - T1505.006
prerequisites:
  - T1505
severity_boost:
  T1505: "Chain with T1505 for deeper attack path"
  T1505.001: "Chain with T1505.001 for deeper attack path"
  T1505.002: "Chain with T1505.002 for deeper attack path"
---

# T1505.005 Terminal Services DLL

> **Sub-technique of:** T1505

## High-Level Description

Adversaries may abuse components of Terminal Services to enable persistent access to systems. Microsoft Terminal Services, renamed to Remote Desktop Services in some Windows Server OSs as of 2022, enable remote terminal connections to hosts. Terminal Services allows servers to transmit a full, interactive, graphical user interface to clients via RDP.

Windows Services that are run as a "generic" process (ex: <code>svchost.exe</code>) load the service's DLL file, the location of which is stored in a Registry entry named <code>ServiceDll</code>. The <code>termsrv.dll</code> file, typically stored in `%SystemRoot%\System32\`, is the default <code>ServiceDll</code> value for Terminal Services in `HKLM\System\CurrentControlSet\services\TermService\Parameters\`.

Adversaries may modify and/or replace the Terminal Services DLL to enable persistent access to victimized hosts. Modifications to this DLL could be done to execute arbitrary payloads (while also potentially preserving normal <code>termsrv.dll</code> functionality) as well as to simply enable abusable features of Terminal Services. For example, an adversary may enable features such as concurrent Remote Desktop Protocol sessions by either patching the <code>termsrv.dll</code> file or modifying the <code>ServiceDll</code> value to point to a DLL that provides increased RDP functionality. On a non-server Windows OS this increased functionality may also enable an adversary to avoid Terminal Services prompts that warn/log out users of a system when a new RDP session is created.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Terminal Services DLL technique is applicable to target environment
- [ ] Check Windows systems for indicators of Terminal Services DLL
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Simulate Patching termsrv.dll

Simulates patching of termsrv.dll by making a benign change to the file and replacing it with the original afterwards.
Before we can make the modifications we need to take ownership of the file and grant ourselves the necessary permissions.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$termsrvDll = "C:\Windows\System32\termsrv.dll"

$ACL = Get-Acl $termsrvDll
$permission = "Administrators","FullControl","Allow"
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
$ACL.SetAccessRule($accessRule)
Set-Acl -Path $termsrvDll -AclObject $ACL

Copy-Item -Path "C:\Windows\System32\termsrv.dll" -Destination "C:\Windows\System32\termsrv_backup.dll" -ErrorAction Ignore
Add-Content -Path "C:\Windows\System32\termsrv.dll" -Value "`n" -NoNewline -ErrorAction Ignore
Move-Item -Path "C:\Windows\System32\termsrv_backup.dll" -Destination "C:\Windows\System32\termsrv.dll" -Force -ErrorAction Ignore
```

### Atomic Test 2: Modify Terminal Services DLL Path

This atomic test simulates the modification of the ServiceDll value in HKLM\System\CurrentControlSet\services\TermService\Parameters. This technique may be leveraged by adversaries to establish persistence by loading a patched version of the DLL containing malicious code.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$termsrvDll = "C:\Windows\System32\termsrv.dll"

$ACL = Get-Acl $termsrvDll
$permission = "Administrators","FullControl","Allow"
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
$ACL.SetAccessRule($accessRule)
Set-Acl -Path $termsrvDll -AclObject $ACL

Copy-Item -Path $termsrvDll -Destination "$HOME\AtomicTest.dll"

$newServiceDll = "$HOME\AtomicTest.dll"

$registryPath = "HKLM:\System\CurrentControlSet\services\TermService\Parameters"

# Check if the registry key exists
if (Test-Path -Path $registryPath) {
    # Modify the ServiceDll value in the registry
    Set-ItemProperty -Path $registryPath -Name "ServiceDll" -Value $newServiceDll
    Write-Host "ServiceDll value in the registry has been updated to: $newServiceDll"
} else {
    Write-Host "Registry key not found. Make sure the 'TermService\Parameters' key exists."
}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Terminal Services DLL by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1505.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit
Regularly check component software on critical services that adversaries may target for persistence to verify the integrity of the systems and identify if unexpected changes have been made.

### M1024 Restrict Registry Permissions
Consider using Group Policy to configure and block modifications to Terminal Services parameters in the Registry.


## Detection

### Detection Strategy for T1505.005 – Terminal Services DLL Modification (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Terminal Services DLL technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [James TermServ DLL](https://x.com/james_inthe_box/status/1150495335812177920)
- [Microsoft System Services Fundamentals](https://social.technet.microsoft.com/wiki/contents/articles/12229.windows-system-services-fundamentals.aspx)
- [Microsoft Remote Desktop Services](https://docs.microsoft.com/windows/win32/termserv/about-terminal-services)
- [RDPWrap Github](https://github.com/stascorp/rdpwrap)
- [Windows OS Hub RDP](http://woshub.com/how-to-allow-multiple-rdp-sessions-in-windows-10/)
- [Atomic Red Team - T1505.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1505.005)
- [MITRE ATT&CK - T1505.005](https://attack.mitre.org/techniques/T1505/005)
