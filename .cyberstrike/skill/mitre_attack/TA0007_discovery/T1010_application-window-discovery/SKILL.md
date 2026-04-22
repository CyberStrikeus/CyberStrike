---
name: "T1010_application-window-discovery"
description: "Adversaries may attempt to get a listing of open application windows."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1010
  - discovery
  - linux
  - windows
  - macos
technique_id: "T1010"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1010"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1010 Application Window Discovery

## High-Level Description

Adversaries may attempt to get a listing of open application windows. Window listings could convey information about how the system is used. For example, information about application windows could be used identify potential data to collect as well as identifying security tooling (Security Software Discovery) to evade.

Adversaries typically abuse system features for this type of enumeration. For example, they may gather information through native system features such as Command and Scripting Interpreter commands and Native API functions.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Application Window Discovery technique is applicable to target environment
- [ ] Check Linux systems for indicators of Application Window Discovery
- [ ] Check Windows systems for indicators of Application Window Discovery
- [ ] Check macOS systems for indicators of Application Window Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: List Process Main Windows - C# .NET

Compiles and executes C# code to list main window titles associated with each process.

Upon successful execution, powershell will download the .cs from the Atomic Red Team repo, and cmd.exe will compile and execute T1010.exe. Upon T1010.exe execution, expected output will be via stdout.

**Supported Platforms:** windows

```cmd
C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe -out:#{output_file_name} "#{input_source_code}"
#{output_file_name}
```

**Dependencies:**

- T1010.cs must exist on disk at specified location (#{input_source_code})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Application Window Discovery by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Application Window Enumeration via API or Scripting

## Risk Assessment

| Finding                                           | Severity | Impact    |
| ------------------------------------------------- | -------- | --------- |
| Application Window Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ESET Grandoreiro April 2020](https://www.welivesecurity.com/2020/04/28/grandoreiro-how-engorged-can-exe-get/)
- [Prevailion DarkWatchman 2021](https://web.archive.org/web/20220629230035/https://www.prevailion.com/darkwatchman-new-fileless-techniques/)
- [Atomic Red Team - T1010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1010)
- [MITRE ATT&CK - T1010](https://attack.mitre.org/techniques/T1010)
