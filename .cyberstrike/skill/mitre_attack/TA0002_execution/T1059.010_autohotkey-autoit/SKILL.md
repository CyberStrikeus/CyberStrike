---
name: "T1059.010_autohotkey-autoit"
description: "Adversaries may execute commands and perform malicious tasks using AutoIT and AutoHotKey automation scripts."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.010
  - execution
  - windows
  - sub-technique
technique_id: "T1059.010"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1059/010"
tech_stack:
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.005
  - T1059.006
  - T1059.007
  - T1059.008
  - T1059.009
  - T1059.011
  - T1059.012
  - T1059.013
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.001: "Chain with T1059.001 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
---

# T1059.010 AutoHotKey & AutoIT

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may execute commands and perform malicious tasks using AutoIT and AutoHotKey automation scripts. AutoIT and AutoHotkey (AHK) are scripting languages that enable users to automate Windows tasks. These automation scripts can be used to perform a wide variety of actions, such as clicking on buttons, entering text, and opening and closing programs.

Adversaries may use AHK (`.ahk`) and AutoIT (`.au3`) scripts to execute malicious code on a victim's system. For example, adversaries have used for AHK to execute payloads and other modular malware such as keyloggers. Adversaries have also used custom AHK files containing embedded malware as Phishing payloads.

These scripts may also be compiled into self-contained executable payloads (`.exe`).

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Windows

## What to Check

- [ ] Identify if AutoHotKey & AutoIT technique is applicable to target environment
- [ ] Check Windows systems for indicators of AutoHotKey & AutoIT
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: AutoHotKey script execution

An adversary may attempt to execute malicious script using AutoHotKey software instead of regular terminal like powershell or cmd. A messagebox will be displayed and calculator will popup when the script is executed successfully

**Supported Platforms:** windows

```powershell
Start-Process -FilePath "#{autohotkey_path}" -ArgumentList "#{script_path}"
```

**Dependencies:**

- AutoHotKey executable file must exist on disk at the specified location (#{autohotkey_path})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to AutoHotKey & AutoIT by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention

Use application control to prevent execution of `AutoIt3.exe`, `AutoHotkey.exe`, and other related features that may not be required for a given system or network to prevent potential misuse by adversaries.

## Detection

### Detection Strategy for AutoHotKey & AutoIT Abuse

## Risk Assessment

| Finding                                  | Severity | Impact    |
| ---------------------------------------- | -------- | --------- |
| AutoHotKey & AutoIT technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [AutoHotKey](https://www.autohotkey.com/docs/v1/Program.htm)
- [AutoIT](https://www.autoitscript.com/autoit3/docs/intro/running.htm)
- [Splunk DarkGate](https://www.splunk.com/en_us/blog/security/enter-the-gates-an-analysis-of-the-darkgate-autoit-loader.html)
- [Atomic Red Team - T1059.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.010)
- [MITRE ATT&CK - T1059.010](https://attack.mitre.org/techniques/T1059/010)
