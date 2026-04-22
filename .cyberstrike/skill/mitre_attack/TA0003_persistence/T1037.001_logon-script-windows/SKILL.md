---
name: "T1037.001_logon-script-windows"
description: "Adversaries may use Windows logon scripts automatically executed at logon initialization to establish persistence."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1037.001
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1037.001"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1037/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1037
  - T1037.002
  - T1037.003
  - T1037.004
  - T1037.005
prerequisites:
  - T1037
severity_boost:
  T1037: "Chain with T1037 for deeper attack path"
  T1037.002: "Chain with T1037.002 for deeper attack path"
  T1037.003: "Chain with T1037.003 for deeper attack path"
---

# T1037.001 Logon Script (Windows)

> **Sub-technique of:** T1037

## High-Level Description

Adversaries may use Windows logon scripts automatically executed at logon initialization to establish persistence. Windows allows logon scripts to be run whenever a specific user or group of users log into a system. This is done via adding a path to a script to the <code>HKCU\Environment\UserInitMprLogonScript</code> Registry key.

Adversaries may use these scripts to maintain persistence on a single system. Depending on the access configuration of the logon scripts, either local credentials or an administrator account may be necessary.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if Logon Script (Windows) technique is applicable to target environment
- [ ] Check Windows systems for indicators of Logon Script (Windows)
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Logon Scripts

Adds a registry value to run batch script created in the %temp% directory. Upon execution, there will be a new environment variable in the HKCU\Environment key
that can be viewed in the Registry Editor.

**Supported Platforms:** windows

```cmd
echo "#{script_command}" > #{script_path}
REG.exe ADD HKCU\Environment /v UserInitMprLogonScript /t REG_SZ /d "#{script_path}" /f
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Logon Script (Windows) by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1037.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1024 Restrict Registry Permissions

Ensure proper permissions are set for Registry hives to prevent users from modifying keys for logon scripts that may lead to persistence.

## Detection

### Detect Logon Script Modifications and Execution

## Risk Assessment

| Finding                                     | Severity | Impact      |
| ------------------------------------------- | -------- | ----------- |
| Logon Script (Windows) technique applicable | High     | Persistence |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-276 | Incorrect Default Permissions |

## References

- [Hexacorn Logon Scripts](http://www.hexacorn.com/blog/2014/11/14/beyond-good-ol-run-key-part-18/)
- [TechNet Logon Scripts](<https://technet.microsoft.com/en-us/library/cc758918(v=ws.10).aspx>)
- [Atomic Red Team - T1037.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1037.001)
- [MITRE ATT&CK - T1037.001](https://attack.mitre.org/techniques/T1037/001)
