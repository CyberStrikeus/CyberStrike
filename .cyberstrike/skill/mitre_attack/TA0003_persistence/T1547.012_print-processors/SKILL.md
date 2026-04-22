---
name: "T1547.012_print-processors"
description: "Adversaries may abuse print processors to run malicious DLLs during system boot for persistence and/or privilege escalation."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.012
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.012"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/012"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1547
  - T1547.001
  - T1547.002
  - T1547.003
  - T1547.004
  - T1547.005
  - T1547.006
  - T1547.007
  - T1547.008
  - T1547.009
  - T1547.010
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

# T1547.012 Print Processors

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may abuse print processors to run malicious DLLs during system boot for persistence and/or privilege escalation. Print processors are DLLs that are loaded by the print spooler service, `spoolsv.exe`, during boot.

Adversaries may abuse the print spooler service by adding print processors that load malicious DLLs at startup. A print processor can be installed through the <code>AddPrintProcessor</code> API call with an account that has <code>SeLoadDriverPrivilege</code> enabled. Alternatively, a print processor can be registered to the print spooler service by adding the <code>HKLM\SYSTEM\\[CurrentControlSet or ControlSet001]\Control\Print\Environments\\[Windows architecture: e.g., Windows x64]\Print Processors\\[user defined]\Driver</code> Registry key that points to the DLL.

For the malicious print processor to be correctly installed, the payload must be located in the dedicated system print-processor directory, that can be found with the <code>GetPrintProcessorDirectory</code> API call, or referenced via a relative path from this directory. After the print processors are installed, the print spooler service, which starts during boot, must be restarted in order for them to run.

The print spooler service runs under SYSTEM level permissions, therefore print processors installed by an adversary may run under elevated privileges.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Print Processors technique is applicable to target environment
- [ ] Check Windows systems for indicators of Print Processors
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Print Processors

Establishes persistence by creating a new print processor registry key under HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Print\Environments\Windows x64\Print Processors.
The new print processor will point to a DLL which will be loaded by the spooler service after a reboot. The DLL will then create the file AtomicTest.txt in C:\Users\Public\ as validation that the test is successful.

Note: The test assumes a x64 Windows operating system.

The payload source code is based on a blog post by stmxcsr: [https://stmxcsr.com/persistence/print-processor.html](https://stmxcsr.com/persistence/print-processor.html)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
if( $(get-service -Name spooler).StartType -eq "Disabled") {Set-Service -Name "spooler" -StartupType Automatic}
net stop spooler
Copy-Item "$PathToAtomicsFolder\T1547.012\bin\AtomicTest.dll" C:\Windows\System32\spool\prtprocs\x64\AtomicTest.dll
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Print\Environments\Windows x64\Print Processors\AtomicRedTeam" /v "Driver" /d "AtomicTest.dll" /t REG_SZ /f
net start spooler
if(#{restart}){
  Restart-Computer
}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Print Processors by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
Limit user accounts that can load or unload device drivers by disabling <code>SeLoadDriverPrivilege</code>.


## Detection

### Windows Detection Strategy for T1547.012 - Print Processor DLL Persistence


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Print Processors technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft AddPrintProcessor May 2018](https://docs.microsoft.com/en-us/windows/win32/printdocs/addprintprocessor)
- [Microsoft Intro Print Processors](https://learn.microsoft.com/windows-hardware/drivers/print/introduction-to-print-processors)
- [ESET PipeMon May 2020](https://www.welivesecurity.com/2020/05/21/no-game-over-winnti-group/)
- [Atomic Red Team - T1547.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.012)
- [MITRE ATT&CK - T1547.012](https://attack.mitre.org/techniques/T1547/012)
