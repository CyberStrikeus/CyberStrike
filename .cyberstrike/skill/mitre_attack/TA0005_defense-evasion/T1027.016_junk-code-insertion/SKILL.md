---
name: "T1027.016_junk-code-insertion"
description: "Adversaries may use junk code / dead code to obfuscate a malware’s functionality."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.016
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.016"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/016"
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
  - T1027.010
  - T1027.011
  - T1027.012
  - T1027.013
  - T1027.014
  - T1027.015
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.016 Junk Code Insertion

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may use junk code / dead code to obfuscate a malware’s functionality. Junk code is code that either does not execute, or if it does execute, does not change the functionality of the code. Junk code makes analysis more difficult and time-consuming, as the analyst steps through non-functional code instead of analyzing the main code. It also may hinder detections that rely on static code analysis due to the use of benign functionality, especially when combined with Compression or Software Packing.

No-Operation (NOP) instructions are an example of dead code commonly used in x86 assembly language. They are commonly used as the 0x90 opcode. When NOPs are added to malware, the disassembler may show the NOP instructions, leading to the analyst needing to step through them.

The use of junk / dead code insertion is distinct from Binary Padding because the purpose is to obfuscate the functionality of the code, rather than simply to change the malware’s signature.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Junk Code Insertion technique is applicable to target environment
- [ ] Check Linux systems for indicators of Junk Code Insertion
- [ ] Check macOS systems for indicators of Junk Code Insertion
- [ ] Check Windows systems for indicators of Junk Code Insertion
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Junk Code Insertion by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.016 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1049 Antivirus/Antimalware

Anti-virus can be used to automatically detect and quarantine suspicious files. Behavior-based detections, rather than reliance on static code analysis, may help to identify malicious files that rely heavily on junk code.

## Detection

### Detection Strategy for Junk Code Obfuscation with Suspicious Execution Patterns

## Risk Assessment

| Finding                                  | Severity | Impact          |
| ---------------------------------------- | -------- | --------------- |
| Junk Code Insertion technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [ReasonLabs](https://cyberpedia.reasonlabs.com/EN/dead%20code%20insertion.html)
- [ReasonLabs Cyberpedia Junk Code](https://cyberpedia.reasonlabs.com/EN/junk%20code.html)
- [Atomic Red Team - T1027.016](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.016)
- [MITRE ATT&CK - T1027.016](https://attack.mitre.org/techniques/T1027/016)
