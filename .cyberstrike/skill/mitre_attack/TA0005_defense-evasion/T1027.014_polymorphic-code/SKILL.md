---
name: "T1027.014_polymorphic-code"
description: "Adversaries may utilize polymorphic code (also known as metamorphic or mutating code) to evade detection."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.014
  - defense-evasion
  - windows
  - macos
  - linux
  - sub-technique
technique_id: "T1027.014"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1027/014"
tech_stack:
  - windows
  - macos
  - linux
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

# T1027.014 Polymorphic Code

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may utilize polymorphic code (also known as metamorphic or mutating code) to evade detection. Polymorphic code is a type of software capable of changing its runtime footprint during code execution. With each execution of the software, the code is mutated into a different version of itself that achieves the same purpose or objective as the original. This functionality enables the malware to evade traditional signature-based defenses, such as antivirus and antimalware tools.
Other obfuscation techniques can be used in conjunction with polymorphic code to accomplish the intended effects, including using mutation engines to conduct actions such as Software Packing, Command Obfuscation, or Encrypted/Encoded File.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, macOS, Linux

## What to Check

- [ ] Identify if Polymorphic Code technique is applicable to target environment
- [ ] Check Windows systems for indicators of Polymorphic Code
- [ ] Check macOS systems for indicators of Polymorphic Code
- [ ] Check Linux systems for indicators of Polymorphic Code
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Polymorphic Code by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.014 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

On Windows 10+, enable Attack Surface Reduction (ASR) rules to prevent execution of potentially obfuscated payloads

### M1049 Antivirus/Antimalware

Anti-virus can be used to automatically detect and quarantine suspicious files. Employment of advanced anti-malware techniques that make use of technologies like machine learning and behavior-based mechanisms to conduct signature-less malware detection will also be more effective than traditional indicator-based detection methods.

## Detection

### Detection Strategy for Polymorphic Code Mutation and Execution

## Risk Assessment

| Finding                               | Severity | Impact          |
| ------------------------------------- | -------- | --------------- |
| Polymorphic Code technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [polymorphic-blackberry](https://www.blackberry.com/us/en/solutions/endpoint-security/ransomware-protection/polymorphic-malware)
- [polymorphic-sentinelone](https://www.sentinelone.com/cybersecurity-101/threat-intelligence/what-is-polymorphic-malware)
- [polymorphic-medium](https://medium.com/@shellseekerscyber/explainer-packed-malware-16f09cc75035)
- [polymorphic-linkedin](https://www.linkedin.com/pulse/techniques-concealing-malware-hindering-analysis-packing-akshay-unijc)
- [Atomic Red Team - T1027.014](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.014)
- [MITRE ATT&CK - T1027.014](https://attack.mitre.org/techniques/T1027/014)
