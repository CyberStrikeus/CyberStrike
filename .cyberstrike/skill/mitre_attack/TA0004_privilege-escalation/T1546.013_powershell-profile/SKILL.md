---
name: "T1546.013_powershell-profile"
description: "Adversaries may gain persistence and elevate privileges by executing malicious content triggered by PowerShell profiles."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.013
  - privilege-escalation
  - persistence
  - windows
  - sub-technique
technique_id: "T1546.013"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1546/013"
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

# T1546.013 PowerShell Profile

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may gain persistence and elevate privileges by executing malicious content triggered by PowerShell profiles. A PowerShell profile (<code>profile.ps1</code>) is a script that runs when PowerShell starts and can be used as a logon script to customize user environments.

PowerShell supports several profiles depending on the user or host program. For example, there can be different profiles for PowerShell host programs such as the PowerShell console, PowerShell ISE or Visual Studio Code. An administrator can also configure a profile that applies to all users and host programs on the local computer.

Adversaries may modify these profiles to include arbitrary commands, functions, modules, and/or PowerShell drives to gain persistence. Every time a user opens a PowerShell session the modified script will be executed unless the <code>-NoProfile</code> flag is used when it is launched.

An adversary may also be able to escalate privileges if a script in a PowerShell profile is loaded and executed by an account with higher privileges, such as a domain administrator.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if PowerShell Profile technique is applicable to target environment
- [ ] Check Windows systems for indicators of PowerShell Profile
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Append malicious start-process cmdlet

Appends a start process cmdlet to the current user's powershell profile pofile that points to a malicious executable. Upon execution, calc.exe will be launched.

**Supported Platforms:** windows

```powershell
Add-Content #{ps_profile} -Value ""
Add-Content #{ps_profile} -Value "Start-Process #{exe_path}"
powershell -Command exit
```

**Dependencies:**

- Ensure a powershell profile exists for the current user

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to PowerShell Profile by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.013 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1045 Code Signing

Enforce execution of only signed PowerShell scripts. Sign profiles to avoid them from being modified.

### M1022 Restrict File and Directory Permissions

Making PowerShell profiles immutable and only changeable by certain administrators will limit the ability for adversaries to easily create user level persistence.

### M1054 Software Configuration

Avoid PowerShell profiles if not needed. Use the -No Profile flag with when executing PowerShell scripts remotely to prevent local profiles and scripts from being executed.

## Detection

### Detection Strategy for PowerShell Profile Persistence via profile.ps1 Modification

## Risk Assessment

| Finding                                 | Severity | Impact               |
| --------------------------------------- | -------- | -------------------- |
| PowerShell Profile technique applicable | High     | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [Wits End and Shady PowerShell Profiles](https://witsendandshady.blogspot.com/2019/06/lab-notes-persistence-and-privilege.html)
- [ESET Turla PowerShell May 2019](https://www.welivesecurity.com/2019/05/29/turla-powershell-usage/)
- [Malware Archaeology PowerShell Cheat Sheet](http://www.malwarearchaeology.com/s/Windows-PowerShell-Logging-Cheat-Sheet-ver-June-2016-v2.pdf)
- [Microsoft About Profiles](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles?view=powershell-6)
- [Microsoft Profiles](https://docs.microsoft.com/powershell/module/microsoft.powershell.core/about/about_profiles)
- [Atomic Red Team - T1546.013](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.013)
- [MITRE ATT&CK - T1546.013](https://attack.mitre.org/techniques/T1546/013)
