---
name: "T1027.003_steganography"
description: "Adversaries may use steganography techniques in order to prevent the detection of hidden information."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.003
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1027.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/003"
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
  - T1027.016
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.003 Steganography

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may use steganography techniques in order to prevent the detection of hidden information. Steganographic techniques can be used to hide data in digital media such as images, audio tracks, video clips, or text files.

Duqu was an early example of malware that used steganography. It encrypted the gathered information from a victim's system and hid it within an image before exfiltrating the image to a C2 server.

By the end of 2017, a threat group used <code>Invoke-PSImage</code> to hide PowerShell commands in an image file (.png) and execute the code on a victim's system. In this particular case the PowerShell code downloaded another obfuscated script to gather intelligence from the victim's machine and communicate it back to the adversary.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Steganography technique is applicable to target environment
- [ ] Check Linux systems for indicators of Steganography
- [ ] Check macOS systems for indicators of Steganography
- [ ] Check Windows systems for indicators of Steganography
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Steganography by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Steganographic Abuse in File & Script Execution

## Risk Assessment

| Finding                            | Severity | Impact          |
| ---------------------------------- | -------- | --------------- |
| Steganography technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [McAfee Malicious Doc Targets Pyeongchang Olympics](https://securingtomorrow.mcafee.com/mcafee-labs/malicious-document-targets-pyeongchang-olympics/)
- [Wikipedia Duqu](https://en.wikipedia.org/wiki/Duqu)
- [Atomic Red Team - T1027.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.003)
- [MITRE ATT&CK - T1027.003](https://attack.mitre.org/techniques/T1027/003)
