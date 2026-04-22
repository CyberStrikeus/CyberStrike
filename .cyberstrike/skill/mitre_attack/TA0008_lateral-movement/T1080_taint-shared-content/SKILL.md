---
name: "T1080_taint-shared-content"
description: "Adversaries may deliver payloads to remote systems by adding content to shared storage locations, such as network drives or internal code repositories."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1080
  - lateral-movement
  - windows
  - saas
  - linux
  - macos
  - office-suite
technique_id: "T1080"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - Windows
  - SaaS
  - Linux
  - macOS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1080"
tech_stack:
  - windows
  - saas
  - linux
  - macos
  - office
cwe_ids:
  - CWE-284
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1080 Taint Shared Content

## High-Level Description

Adversaries may deliver payloads to remote systems by adding content to shared storage locations, such as network drives or internal code repositories. Content stored on network drives or in other shared locations may be tainted by adding malicious programs, scripts, or exploit code to otherwise valid files. Once a user opens the shared tainted content, the malicious portion can be executed to run the adversary's code on a remote system. Adversaries may use tainted shared content to move laterally.

A directory share pivot is a variation on this technique that uses several other techniques to propagate malware when users access a shared network directory. It uses Shortcut Modification of directory .LNK files that use Masquerading to look like the real directories, which are hidden through Hidden Files and Directories. The malicious .LNK-based directories have an embedded command that executes the hidden malware file in the directory and then opens the real intended directory so that the user's expected action still occurs. When used with frequently used network directories, the technique may result in frequent reinfections and broad access to systems and potentially to new and higher privileged accounts. 

Adversaries may also compromise shared network directories through binary infections by appending or prepending its code to the healthy binary on the shared network directory. The malware may modify the original entry point (OEP) of the healthy binary to ensure that it is executed before the legitimate code. The infection could continue to spread via the newly infected file when it is executed by a remote system. These infections may target both binary and non-binary formats that end with extensions including, but not limited to, .EXE, .DLL, .SCR, .BAT, and/or .VBS.

## Kill Chain Phase

- Lateral Movement (TA0008)

**Platforms:** Windows, SaaS, Linux, macOS, Office Suite

## What to Check

- [ ] Identify if Taint Shared Content technique is applicable to target environment
- [ ] Check Windows systems for indicators of Taint Shared Content
- [ ] Check SaaS systems for indicators of Taint Shared Content
- [ ] Check Linux systems for indicators of Taint Shared Content
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Taint Shared Content by examining the target platforms (Windows, SaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1080 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1049 Antivirus/Antimalware
Anti-virus can be used to automatically quarantine suspicious files.

### M1038 Execution Prevention
Identify potentially malicious software that may be used to taint content or may result from it and audit and/or block the unknown programs by using application control tools, like AppLocker, or Software Restriction Policies where appropriate.

### M1022 Restrict File and Directory Permissions
Protect shared folders by minimizing users who have write access.

### M1050 Exploit Protection
Use utilities that detect or mitigate common features used in exploitation, such as the Microsoft Enhanced Mitigation Experience Toolkit (EMET).


## Detection

### Detection of Tainted Content Written to Shared Storage


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Taint Shared Content technique applicable | High | Lateral Movement |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [Retwin Directory Share Pivot](https://rewtin.blogspot.ch/2017/11/abusing-user-shares-for-efficient.html)
- [Atomic Red Team - T1080](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1080)
- [MITRE ATT&CK - T1080](https://attack.mitre.org/techniques/T1080)
