---
name: "T1027.010_command-obfuscation"
description: "Adversaries may obfuscate content during command execution to impede detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.010
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.010"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/010"
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
  - T1027.004
  - T1027.005
  - T1027.006
  - T1027.007
  - T1027.008
  - T1027.009
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

# T1027.010 Command Obfuscation

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may obfuscate content during command execution to impede detection. Command-line obfuscation is a method of making strings and patterns within commands and scripts more difficult to signature and analyze. This type of obfuscation can be included within commands executed by delivered payloads (e.g., Phishing and Drive-by Compromise) or interactively via Command and Scripting Interpreter.

For example, adversaries may abuse syntax that utilizes various symbols and escape characters (such as spacing, `^`, `+`. `$`, and `%`) to make commands difficult to analyze while maintaining the same intended functionality. Many languages support built-in obfuscation in the form of base64 or URL encoding. Adversaries may also manually implement command obfuscation via string splitting (`“Wor”+“d.Application”`), order and casing of characters (`rev <<<'dwssap/cte/ tac'`), globing (`mkdir -p '/tmp/:&$NiA'`), as well as various tricks involving passing strings through tokens/environment variables/input streams.

Adversaries may also use tricks such as directory traversals to obfuscate references to the binary being invoked by a command (`C:\voi\pcw\..\..\Windows\tei\qs\k\..\..\..\system32\erool\..\wbem\wg\je\..\..\wmic.exe shadowcopy delete`).

Tools such as <code>Invoke-Obfuscation</code> and <code>Invoke-DOSfucation</code> have also been used to obfuscate commands.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Command Obfuscation technique is applicable to target environment
- [ ] Check Linux systems for indicators of Command Obfuscation
- [ ] Check macOS systems for indicators of Command Obfuscation
- [ ] Check Windows systems for indicators of Command Obfuscation
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Command Obfuscation by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.010 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

On Windows 10+, enable Attack Surface Reduction (ASR) rules to block execution of potentially obfuscated scripts.

### M1049 Antivirus/Antimalware

Consider utilizing the Antimalware Scan Interface (AMSI) on Windows 10+ to analyze commands after being processed/interpreted.

## Detection

### Detection Strategy for Command Obfuscation

## Risk Assessment

| Finding                                  | Severity | Impact          |
| ---------------------------------------- | -------- | --------------- |
| Command Obfuscation technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Twitter Richard WMIC](https://x.com/rfackroyd/status/1639136000755765254)
- [Invoke-Obfuscation](https://github.com/danielbohannon/Invoke-Obfuscation)
- [Invoke-DOSfuscation](https://github.com/danielbohannon/Invoke-DOSfuscation)
- [FireEye Obfuscation June 2017](https://web.archive.org/web/20170923102302/https://www.fireeye.com/blog/threat-research/2017/06/obfuscation-in-the-wild.html)
- [Malware Monday VBE](https://bromiley.medium.com/malware-monday-vbscript-and-vbe-files-292252c1a16)
- [Akamai JS](https://www.akamai.com/blog/security/catch-me-if-you-can-javascript-obfuscation)
- [Bashfuscator Command Obfuscators](https://bashfuscator.readthedocs.io/en/latest/Mutators/command_obfuscators/index.html)
- [Microsoft PowerShellB64](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1#-encodedcommand-base64encodedcommand)
- [RC PowerShell](https://redcanary.com/threat-detection-report/techniques/powershell/)
- [Atomic Red Team - T1027.010](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.010)
- [MITRE ATT&CK - T1027.010](https://attack.mitre.org/techniques/T1027/010)
