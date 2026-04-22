---
name: "T1027.015_compression"
description: "Adversaries may use compression to obfuscate their payloads or files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.015
  - defense-evasion
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1027.015"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1027/015"
tech_stack:
  - linux
  - windows
  - macos
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
  - T1027.016
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.015 Compression

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may use compression to obfuscate their payloads or files. Compressed file formats such as ZIP, gzip, 7z, and RAR can compress and archive multiple files together to make it easier and faster to transfer files. In addition to compressing files, adversaries may also compress shellcode directly - for example, in order to store it in a Windows Registry key (i.e., Fileless Storage).

In order to further evade detection, adversaries may combine multiple ZIP files into one archive. This process of concatenation creates an archive that appears to be a single archive but in fact contains the central directories of the embedded archives. Some ZIP readers, such as 7zip, may not be able to identify concatenated ZIP files and miss the presence of the malicious payload.

File archives may be sent as one Spearphishing Attachment through email. Adversaries have sent malicious payloads as archived files to encourage the user to interact with and extract the malicious payload onto their system (i.e., Malicious File). However, some file compression tools, such as 7zip, can be used to produce self-extracting archives. Adversaries may send self-extracting archives to hide the functionality of their payload and launch it without requiring multiple actions from the user.

Compression may be used in combination with Encrypted/Encoded File where compressed files are encrypted and password-protected.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Compression technique is applicable to target environment
- [ ] Check Linux systems for indicators of Compression
- [ ] Check Windows systems for indicators of Compression
- [ ] Check macOS systems for indicators of Compression
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compression by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.015 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1049 Antivirus/Antimalware
Anti-virus can be used to automatically detect and quarantine suspicious files. Consider anti-virus products capable of unpacking and inspecting compressed files recursively, as well as analyzing SFX archives.


## Detection

### Detection Strategy for Compressed Payload Creation and Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Compression technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Perception Point](https://perception-point.io/blog/evasive-concatenated-zip-trojan-targets-windows-users/)
- [NTT Security Flagpro new December 2021](https://insight-jp.nttsecurity.com/post/102hf3q/flagpro-the-new-malware-used-by-blacktech)
- [The Hacker News](https://thehackernews.com/2023/04/hackers-using-self-extracting-archives.html)
- [Trustwave Pillowmint June 2020](https://www.trustwave.com/en-us/resources/blogs/spiderlabs-blog/pillowmint-fin7s-monkey-thief/)
- [Atomic Red Team - T1027.015](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.015)
- [MITRE ATT&CK - T1027.015](https://attack.mitre.org/techniques/T1027/015)
