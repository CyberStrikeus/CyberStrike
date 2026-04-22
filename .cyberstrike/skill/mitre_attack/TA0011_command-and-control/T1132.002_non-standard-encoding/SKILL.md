---
name: "T1132.002_non-standard-encoding"
description: "Adversaries may encode data with a non-standard data encoding system to make the content of command and control traffic more difficult to detect."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1132.002
  - command-and-control
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1132.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1132/002"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1132
  - T1132.001
prerequisites:
  - T1132
severity_boost:
  T1132: "Chain with T1132 for deeper attack path"
  T1132.001: "Chain with T1132.001 for deeper attack path"
---

# T1132.002 Non-Standard Encoding

> **Sub-technique of:** T1132

## High-Level Description

Adversaries may encode data with a non-standard data encoding system to make the content of command and control traffic more difficult to detect. Command and control (C2) information can be encoded using a non-standard data encoding system that diverges from existing protocol specifications. Non-standard data encoding schemes may be based on or related to standard data encoding schemes, such as a modified Base64 encoding for the message body of an HTTP request.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Non-Standard Encoding technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Non-Standard Encoding
- [ ] Check Linux systems for indicators of Non-Standard Encoding
- [ ] Check macOS systems for indicators of Non-Standard Encoding
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Non-Standard Encoding by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1132.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific obfuscation technique used by a particular adversary or tool, and will likely be different across various malware families and versions. Adversaries will likely change tool C2 signatures over time or construct protocols in such a way as to avoid detection by common defensive tools.

## Detection

### Behavior-chain detection for T1132.002 Data Encoding: Non-Standard Encoding across Windows, Linux, macOS, ESXi

## Risk Assessment

| Finding                                    | Severity | Impact              |
| ------------------------------------------ | -------- | ------------------- |
| Non-Standard Encoding technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Wikipedia Binary-to-text Encoding](https://en.wikipedia.org/wiki/Binary-to-text_encoding)
- [Wikipedia Character Encoding](https://en.wikipedia.org/wiki/Character_encoding)
- [Atomic Red Team - T1132.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1132.002)
- [MITRE ATT&CK - T1132.002](https://attack.mitre.org/techniques/T1132/002)
