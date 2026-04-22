---
name: "T1547.008_lsass-driver"
description: "Adversaries may modify or add LSASS drivers to obtain persistence on compromised systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1547.008
  - persistence
  - privilege-escalation
  - windows
  - sub-technique
technique_id: "T1547.008"
tactic: "persistence"
all_tactics:
  - persistence
  - privilege-escalation
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1547/008"
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

# T1547.008 LSASS Driver

> **Sub-technique of:** T1547

## High-Level Description

Adversaries may modify or add LSASS drivers to obtain persistence on compromised systems. The Windows security subsystem is a set of components that manage and enforce the security policy for a computer or domain. The Local Security Authority (LSA) is the main component responsible for local security policy and user authentication. The LSA includes multiple dynamic link libraries (DLLs) associated with various other security functions, all of which run in the context of the LSA Subsystem Service (LSASS) lsass.exe process.

Adversaries may target LSASS drivers to obtain persistence. By either replacing or adding illegitimate drivers (e.g., Hijack Execution Flow), an adversary can use LSA operations to continuously execute malicious payloads.

## Kill Chain Phase

- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows

## What to Check

- [ ] Identify if LSASS Driver technique is applicable to target environment
- [ ] Check Windows systems for indicators of LSASS Driver
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Modify Registry to load Arbitrary DLL into LSASS - LsaDbExtPt

The following Atomic will modify an undocumented registry key that may be abused to load a arbitrary DLL into LSASS. 

Upon execution, the registry key will be modified and a value will contain the path to the DLL. 
Reference: https://blog.xpnsec.com/exploring-mimikatz-part-1/ and source https://github.com/oxfemale/LogonCredentialsSteal
Note that if any LSA based protection is enabled, this will most likely not be successful with LSASS.exe loading the DLL.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Services\NTDS -Name LsaDbExtPt -Value "#{dll_path}"
```

**Dependencies:**
- lsass_lib.dll must exist on disk at specified location (#{dll_path})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to LSASS Driver by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1547.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1025 Privileged Process Integrity
On Windows 8.1 and Server 2012 R2, enable LSA Protection by setting the Registry key <code>HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Lsa\\RunAsPPL</code> to <code>dword:00000001</code>. LSA Protection ensures that LSA plug-ins and drivers are only loaded if they are digitally signed with a Microsoft signature and adhere to the Microsoft Security Development Lifecycle (SDL) process guidance.

### M1043 Credential Access Protection
On Windows 10 and Server 2016, enable Windows Defender Credential Guard to run lsass.exe in an isolated virtualized environment without any device drivers.

### M1044 Restrict Library Loading
Ensure safe DLL search mode is enabled <code>HKEY_LOCAL_MACHINE\\System\\CurrentControlSet\\Control\\Session Manager\\SafeDllSearchMode</code> to mitigate risk that lsass.exe loads a malicious code library.


## Detection

### Detect unauthorized LSASS driver persistence via LSA plugin abuse (Windows)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| LSASS Driver technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft LSA Protection Mar 2014](https://technet.microsoft.com/library/dn408187.aspx)
- [Microsoft DLL Security](https://msdn.microsoft.com/library/windows/desktop/ff919712.aspx)
- [Microsoft Security Subsystem](https://technet.microsoft.com/library/cc961760.aspx)
- [TechNet Autoruns](https://technet.microsoft.com/en-us/sysinternals/bb963902)
- [Atomic Red Team - T1547.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1547.008)
- [MITRE ATT&CK - T1547.008](https://attack.mitre.org/techniques/T1547/008)
