---
name: "T1027.004_compile-after-delivery"
description: "Adversaries may attempt to make payloads difficult to discover and analyze by delivering files to victims as uncompiled code."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.004
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/004"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1027
  - T1027.001
  - T1027.002
  - T1027.003
  - T1027.005
  - T1027.006
  - T1027.007
  - T1027.008
  - T1027.009
  - T1027.010
  - T1027.011
  - T1027.012
  - T1027.013
  - T1027.014
  - T1027.015
  - T1027.016
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.004 Compile After Delivery

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may attempt to make payloads difficult to discover and analyze by delivering files to victims as uncompiled code. Text-based source code files may subvert analysis and scrutiny from protections targeting executables/binaries. These payloads will need to be compiled before execution; typically via native utilities such as ilasm.exe, csc.exe, or GCC/MinGW.

Source code payloads may also be encrypted, encoded, and/or embedded within other files, such as those delivered as a Phishing. Payloads may also be delivered in formats unrecognizable and inherently benign to the native OS (ex: EXEs on macOS/Linux) before later being (re)compiled into a proper executable binary with a bundled compiler and execution framework.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Compile After Delivery technique is applicable to target environment
- [ ] Check Linux systems for indicators of Compile After Delivery
- [ ] Check macOS systems for indicators of Compile After Delivery
- [ ] Check Windows systems for indicators of Compile After Delivery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Compile After Delivery using csc.exe

Compile C# code using csc.exe binary used by .NET
Upon execution an exe named T1027.004.exe will be placed in the temp folder

**Supported Platforms:** windows

```cmd
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /out:#{output_file} "#{input_file}"
```

**Dependencies:**
- C# file must exist on disk at specified location (#{input_file})

### Atomic Test 2: Dynamic C# Compile

When C# is compiled dynamically, a .cmdline file will be created as a part of the process. 
Certain processes are not typically observed compiling C# code, but can do so without touching disk. This can be used to unpack a payload for execution.
The exe file that will be executed is named as T1027.004_DynamicCompile.exe is contained in the 'bin' folder of this atomic, and the source code to the file is in the 'src' folder.
Upon execution, the exe will print 'T1027.004 Dynamic Compile'.

**Supported Platforms:** windows

```powershell
Invoke-Expression "#{input_file}"
```

**Dependencies:**
- exe file must exist on disk at specified location (#{input_file})

### Atomic Test 3: C compile

Compile a c file with either gcc or clang on FreeBSD, Linux or Macos.

**Supported Platforms:** linux, macos

```bash
gcc #{input_file} && ./a.out
clang #{input_file} && ./a.out
```

**Dependencies:**
- the source file must exist on disk at specified location (#{input_file})

### Atomic Test 4: CC compile

Compile a c file with either gcc or clang on FreeBSD, Linux or Macos.

**Supported Platforms:** linux, macos

```bash
g++ #{input_file} && ./a.out
clang++ #{input_file} && ./a.out
```

**Dependencies:**
- the source file must exist on disk at specified location (#{input_file})

### Atomic Test 5: Go compile

Compile a go file with golang on FreeBSD, Linux or Macos.

**Supported Platforms:** linux, macos

```bash
go run #{input_file}
```

**Dependencies:**
- the source file must exist on disk at specified location (#{input_file})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compile After Delivery by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Compile After Delivery - Source Code to Executable Transformation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compile After Delivery technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [ClearSky MuddyWater Nov 2018](https://www.clearskysec.com/wp-content/uploads/2018/11/MuddyWater-Operations-in-Lebanon-and-Oman.pdf)
- [ATTACK IQ](https://www.attackiq.com/2023/03/16/hiding-in-plain-sight/)
- [TrendMicro WindowsAppMac](https://blog.trendmicro.com/trendlabs-security-intelligence/windows-app-runs-on-mac-downloads-info-stealer-and-adware/)
- [Atomic Red Team - T1027.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.004)
- [MITRE ATT&CK - T1027.004](https://attack.mitre.org/techniques/T1027/004)
