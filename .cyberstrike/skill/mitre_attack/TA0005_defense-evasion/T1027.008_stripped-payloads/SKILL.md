---
name: "T1027.008_stripped-payloads"
description: "Adversaries may attempt to make a payload difficult to analyze by removing symbols, strings, and other human readable information."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.008
  - defense-evasion
  - macos
  - linux
  - windows
  - network-devices
  - sub-technique
technique_id: "T1027.008"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - macOS
  - Linux
  - Windows
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1027/008"
tech_stack:
  - macos
  - linux
  - windows
  - network devices
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

# T1027.008 Stripped Payloads

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may attempt to make a payload difficult to analyze by removing symbols, strings, and other human readable information. Scripts and executables may contain variables names and other strings that help developers document code functionality. Symbols are often created by an operating system’s `linker` when executable payloads are compiled. Reverse engineers use these symbols and strings to analyze code and to identify functionality in payloads.

Adversaries may use stripped payloads in order to make malware analysis more difficult. For example, compilers and other tools may provide features to remove or obfuscate strings and symbols. Adversaries have also used stripped payload formats, such as run-only AppleScripts, a compiled and stripped version of AppleScript, to evade detection and analysis. The lack of human-readable information may directly hinder detection and analysis of payloads.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** macOS, Linux, Windows, Network Devices

## What to Check

- [ ] Identify if Stripped Payloads technique is applicable to target environment
- [ ] Check macOS systems for indicators of Stripped Payloads
- [ ] Check Linux systems for indicators of Stripped Payloads
- [ ] Check Windows systems for indicators of Stripped Payloads
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Stripped Payloads by examining the target platforms (macOS, Linux, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Stripped Payloads Across Platforms

## Risk Assessment

| Finding                                | Severity | Impact          |
| -------------------------------------- | -------- | --------------- |
| Stripped Payloads technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [intezer stripped binaries elf files 2018](https://www.intezer.com/blog/malware-analysis/executable-linkable-format-101-part-2-symbols/)
- [SentinelLabs reversing run-only applescripts 2021](https://www.sentinelone.com/labs/fade-dead-adventures-in-reversing-malicious-run-only-applescripts/)
- [Mandiant golang stripped binaries explanation](https://www.mandiant.com/resources/blog/golang-internals-symbol-recovery)
- [Atomic Red Team - T1027.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.008)
- [MITRE ATT&CK - T1027.008](https://attack.mitre.org/techniques/T1027/008)
