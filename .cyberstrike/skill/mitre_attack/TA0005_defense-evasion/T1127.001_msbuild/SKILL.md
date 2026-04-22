---
name: "T1127.001_msbuild"
description: "Adversaries may use MSBuild to proxy execution of code through a trusted Windows utility."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1127.001
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1127.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1127/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1127
  - T1127.002
  - T1127.003
prerequisites:
  - T1127
severity_boost:
  T1127: "Chain with T1127 for deeper attack path"
  T1127.002: "Chain with T1127.002 for deeper attack path"
  T1127.003: "Chain with T1127.003 for deeper attack path"
---

# T1127.001 MSBuild

> **Sub-technique of:** T1127

## High-Level Description

Adversaries may use MSBuild to proxy execution of code through a trusted Windows utility. MSBuild.exe (Microsoft Build Engine) is a software build platform used by Visual Studio. It handles XML formatted project files that define requirements for loading and building various platforms and configurations.

Adversaries can abuse MSBuild to proxy execution of malicious code. The inline task capability of MSBuild that was introduced in .NET version 4 allows for C# or Visual Basic code to be inserted into an XML project file. MSBuild will compile and execute the inline task. MSBuild.exe is a signed Microsoft binary, so when it is used this way it can execute arbitrary code and bypass application control defenses that are configured to allow MSBuild.exe execution.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if MSBuild technique is applicable to target environment
- [ ] Check Windows systems for indicators of MSBuild
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: MSBuild Bypass Using Inline Tasks (C#)

Executes the code in a project file using msbuild.exe. The default C# project example file (T1127.001.csproj) will simply print "Hello From a Code Fragment" and "Hello From a Class." to the screen.

**Supported Platforms:** windows

```cmd
#{msbuildpath}\#{msbuildname} "#{filename}"
```

**Dependencies:**

- Project file must exist on disk at specified location (#{filename})

### Atomic Test 2: MSBuild Bypass Using Inline Tasks (VB)

Executes the code in a project file using msbuild.exe. The default Visual Basic example file (vb.xml) will simply print "Hello from a Visual Basic inline task!" to the screen.

**Supported Platforms:** windows

```cmd
#{msbuildpath}\#{msbuildname} "#{filename}"
```

**Dependencies:**

- Project file must exist on disk at specified location (#{filename})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to MSBuild by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1127.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

MSBuild.exe may not be necessary within an environment and should be removed if not being used.

### M1038 Execution Prevention

Use application control configured to block execution of <code>msbuild.exe</code> if it is not required for a given system or network to prevent potential misuse by adversaries. For example, in Windows 10 and Windows Server 2016 and above, Windows Defender Application Control (WDAC) policy rules may be applied to block the <code>msbuild.exe</code> application and to prevent abuse.

## Detection

### Behavior-chain detection strategy for T1127.001 Trusted Developer Utilities Proxy Execution: MSBuild (Windows)

## Risk Assessment

| Finding                      | Severity | Impact          |
| ---------------------------- | -------- | --------------- |
| MSBuild technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [LOLBAS Msbuild](https://lolbas-project.github.io/lolbas/Binaries/Msbuild/)
- [Microsoft MSBuild Inline Tasks 2017](https://docs.microsoft.com/en-us/visualstudio/msbuild/msbuild-inline-tasks?view=vs-2019#code-element)
- [MSDN MSBuild](https://msdn.microsoft.com/library/dd393574.aspx)
- [Atomic Red Team - T1127.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1127.001)
- [MITRE ATT&CK - T1127.001](https://attack.mitre.org/techniques/T1127/001)
