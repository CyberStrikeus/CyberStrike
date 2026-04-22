---
name: "T1036.008_masquerade-file-type"
description: "Adversaries may masquerade malicious payloads as legitimate files through changes to the payload's formatting, including the file’s signature, extension, icon, and contents."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.008
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1036.008"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1036/008"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.003
  - T1036.004
  - T1036.005
  - T1036.006
  - T1036.007
  - T1036.009
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.008 Masquerade File Type

> **Sub-technique of:** T1036

## High-Level Description

Adversaries may masquerade malicious payloads as legitimate files through changes to the payload's formatting, including the file’s signature, extension, icon, and contents. Various file types have a typical standard format, including how they are encoded and organized. For example, a file’s signature (also known as header or magic bytes) is the beginning bytes of a file and is often used to identify the file’s type. For example, the header of a JPEG file, is <code> 0xFF 0xD8</code> and the file extension is either `.JPE`, `.JPEG` or `.JPG`.

Adversaries may edit the header’s hex code and/or the file extension of a malicious payload in order to bypass file validation checks and/or input sanitization. This behavior is commonly used when payload files are transferred (e.g., Ingress Tool Transfer) and stored (e.g., Upload Malware) so that adversaries may move their malware without triggering detections.

Common non-executable file types and extensions, such as text files (`.txt`) and image files (`.jpg`, `.gif`, etc.) may be typically treated as benign. Based on this, adversaries may use a file extension to disguise malware, such as naming a PHP backdoor code with a file name of <code>test.gif</code>. A user may not know that a file is malicious due to the benign appearance and file extension.

Polyglot files, which are files that have multiple different file types and that function differently based on the application that will execute them, may also be used to disguise malicious malware and capabilities.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Masquerade File Type technique is applicable to target environment
- [ ] Check Linux systems for indicators of Masquerade File Type
- [ ] Check macOS systems for indicators of Masquerade File Type
- [ ] Check Windows systems for indicators of Masquerade File Type
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Masquerade File Type by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

Implement security controls on the endpoint, such as a Host Intrusion Prevention System (HIPS), to identify and prevent execution of files with mismatching file signatures.

### M1049 Antivirus/Antimalware

Anti-virus can be used to automatically quarantine suspicious files.

### M1038 Execution Prevention

Ensure that input sanitization is performed and that files are validated properly before execution; furthermore, implement a strict allow list to ensure that only authorized file types are processed. Restrict and/or block execution of files where headers and extensions do not match.

## Detection

### Detection Strategy for Masquerading via File Type Modification

## Risk Assessment

| Finding                                   | Severity | Impact          |
| ----------------------------------------- | -------- | --------------- |
| Masquerade File Type technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [polygot_icedID](https://unit42.paloaltonetworks.com/polyglot-file-icedid-payload)
- [Atomic Red Team - T1036.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.008)
- [MITRE ATT&CK - T1036.008](https://attack.mitre.org/techniques/T1036/008)
