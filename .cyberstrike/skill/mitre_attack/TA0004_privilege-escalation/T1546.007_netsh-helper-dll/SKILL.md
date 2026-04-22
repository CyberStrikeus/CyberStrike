---
name: "T1546.007_netsh-helper-dll"
description: "Adversaries may establish persistence by executing malicious content triggered by Netsh Helper DLLs."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.007
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.007"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/007"
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
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
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

# T1546.007 Netsh Helper DLL

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence by executing malicious content triggered by Netsh Helper DLLs. Netsh.exe (also referred to as Netshell) is a command-line scripting utility used to interact with the network configuration of a system. It contains functionality to add helper DLLs for extending functionality of the utility. The paths to registered netsh.exe helper DLLs are entered into the Windows Registry at <code>HKLM\SOFTWARE\Microsoft\Netsh</code>.

Adversaries can use netsh.exe helper DLLs to trigger execution of arbitrary code in a persistent manner. This execution would take place anytime netsh.exe is executed, which could happen automatically, with another persistence technique, or if other software (ex: VPN) is present on the system that executes netsh.exe as part of its normal functionality.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Netsh Helper DLL technique is applicable to target environment
- [ ] Check Windows systems for indicators of Netsh Helper DLL
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Netsh Helper DLL Registration

You can register a "helper dll" with Netsh as a persistance mechanism. The code in the dll is executed every time netsh.exe is called.
The NetshHelper.dll provided with the atomic will simply launch notepad when netsh.exe is run.

[Blog](https://htmlpreview.github.io/?https://github.com/MatthewDemaske/blogbackup/blob/master/netshell.html)
[Sample DLL code](https://github.com/outflanknl/NetshHelperBeacon)

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
netsh.exe add helper "#{helper_file}"
taskkill /im notepad.exe /t /f > NUL 2>&1
```

**Dependencies:**
- Helper DLL must exist on disk at specified location (#{helper_file})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Netsh Helper DLL by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Netsh Helper DLL Persistence via Registry and Child Process Monitoring (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Netsh Helper DLL technique applicable | Low | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [Demaske Netsh Persistence](https://htmlpreview.github.io/?https://github.com/MatthewDemaske/blogbackup/blob/master/netshell.html)
- [TechNet Netsh](https://technet.microsoft.com/library/bb490939.aspx)
- [Github Netsh Helper CS Beacon](https://github.com/outflankbv/NetshHelperBeacon)
- [Atomic Red Team - T1546.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.007)
- [MITRE ATT&CK - T1546.007](https://attack.mitre.org/techniques/T1546/007)
