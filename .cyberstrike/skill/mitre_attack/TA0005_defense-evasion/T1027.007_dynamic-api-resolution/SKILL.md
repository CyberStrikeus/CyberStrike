---
name: "T1027.007_dynamic-api-resolution"
description: "Adversaries may obfuscate then dynamically resolve API functions called by their malware in order to conceal malicious functionalities and impair defensive analysis."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.007
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1027.007"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/007"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1027
  - T1027.001
  - T1027.002
  - T1027.003
  - T1027.004
  - T1027.005
  - T1027.006
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

# T1027.007 Dynamic API Resolution

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may obfuscate then dynamically resolve API functions called by their malware in order to conceal malicious functionalities and impair defensive analysis. Malware commonly uses various Native API functions provided by the OS to perform various tasks such as those involving processes, files, and other system artifacts.

API functions called by malware may leave static artifacts such as strings in payload files. Defensive analysts may also uncover which functions a binary file may execute via an import address table (IAT) or other structures that help dynamically link calling code to the shared modules that provide functions.

To avoid static or other defensive analysis, adversaries may use dynamic API resolution to conceal malware characteristics and functionalities. Similar to Software Packing, dynamic API resolution may change file signatures and obfuscate malicious API function calls until they are resolved and invoked during runtime.

Various methods may be used to obfuscate malware calls to API functions. For example, hashes of function names are commonly stored in malware in lieu of literal strings. Malware can use these hashes (or other identifiers) to manually reproduce the linking and loading process using functions such as `GetProcAddress()` and `LoadLibrary()`. These hashes/identifiers can also be further obfuscated using encryption or other string manipulation tricks (requiring various forms of Deobfuscate/Decode Files or Information during execution).

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Dynamic API Resolution technique is applicable to target environment
- [ ] Check Windows systems for indicators of Dynamic API Resolution
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Dynamic API Resolution-Ninja-syscall

This test calls NtCreateFile via API hashing and dynamic syscall resolution. I have dubbed this particular combination of techniques 'Ninja-syscall'. When successful, a new file named 'hello.log' will be created in the default user's temporary folder, which is a common location for a dropper.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Start-Process "#{exe_binary}"
Start-Sleep -Seconds 7
if (Test-Path "C:\Users\Default\AppData\Local\Temp\hello.log") { Remove-Item "C:\Users\Default\AppData\Local\Temp\hello.log" -Force; Write-Host "[+] hello.log removed." }
```

**Dependencies:**
- Portable Executable to run must exist at specified location (#{exe_binary})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Dynamic API Resolution by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Dynamic API Resolution via Hash-Based Function Lookups


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Dynamic API Resolution technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Huntress API Hash](https://www.huntress.com/blog/hackers-no-hashing-randomizing-api-hashes-to-evade-cobalt-strike-shellcode-detection)
- [BlackHat API Packers](https://www.blackhat.com/docs/us-15/materials/us-15-Choi-API-Deobfuscator-Resolving-Obfuscated-API-Functions-In-Modern-Packers.pdf)
- [Drakonia HInvoke](https://dr4k0nia.github.io/dotnet/coding/2022/08/10/HInvoke-and-avoiding-PInvoke.html?s=03)
- [IRED API Hashing](https://www.ired.team/offensive-security/defense-evasion/windows-api-hashing-in-malware)
- [Atomic Red Team - T1027.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.007)
- [MITRE ATT&CK - T1027.007](https://attack.mitre.org/techniques/T1027/007)
