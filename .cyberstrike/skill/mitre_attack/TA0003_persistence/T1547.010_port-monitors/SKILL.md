---
name: "T1547.010_port-monitors"
description: "Adversaries may use port monitors to run an adversary supplied DLL during system boot for persistence or privilege escalation."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.010
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.010"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/010"
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

# T1547.010 Port Monitors

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may use port monitors to run an adversary supplied DLL during system boot for persistence or privilege escalation. A port monitor can be set through the <code>AddMonitor</code> API call to set a DLL to be loaded at startup. This DLL can be located in <code>C:\Windows\System32</code> and will be loaded and run by the print spooler service, `spoolsv.exe`, under SYSTEM level permissions on boot.

Alternatively, an arbitrary DLL can be loaded if permissions allow writing a fully-qualified pathname for that DLL to the `Driver` value of an existing or new arbitrarily named subkey of <code>HKLM\SYSTEM\CurrentControlSet\Control\Print\Monitors</code>. The Registry key contains entries for the following:

- Local Port
- Standard TCP/IP Port
- USB Monitor
- WSD Port

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Port Monitors technique is applicable to target environment
- [ ] Check Windows systems for indicators of Port Monitors
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Add Port Monitor persistence in Registry

Add key-value pair to a Windows Port Monitor registry. On the subsequent reboot DLL will be execute under spoolsv with NT AUTHORITY/SYSTEM privilege.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "hklm\system\currentcontrolset\control\print\monitors\AtomicRedTeam" /v "Driver" /d "#{monitor_dll}" /t REG_SZ /f
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Port Monitors by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for T1547.010 – Port Monitor DLL Persistence via spoolsv.exe (Windows)

## Risk Assessment

| Finding                            | Severity | Impact      |
| ---------------------------------- | -------- | ----------- |
| Port Monitors technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Bloxham](https://www.defcon.org/images/defcon-22/dc-22-presentations/Bloxham/DEFCON-22-Brady-Bloxham-Windows-API-Abuse-UPDATED.pdf)
- [AddMonitor](https://learn.microsoft.com/en-us/windows/win32/printdocs/addmonitor)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Atomic Red Team - T1547.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.010)
- [MITRE ATT&CK - T1547.010](https://attack.mitre.org/techniques/T1547/010)
