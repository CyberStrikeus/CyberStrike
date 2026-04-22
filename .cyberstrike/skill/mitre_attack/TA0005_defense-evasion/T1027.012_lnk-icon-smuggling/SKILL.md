---
name: "T1027.012_lnk-icon-smuggling"
description: "Adversaries may smuggle commands to download malicious payloads past content filters by hiding them within otherwise seemingly benign windows shortcut files."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.012
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1027.012"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1027/012"
tech_stack:
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

# T1027.012 LNK Icon Smuggling

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may smuggle commands to download malicious payloads past content filters by hiding them within otherwise seemingly benign windows shortcut files. Windows shortcut files (.LNK) include many metadata fields, including an icon location field (also known as the `IconEnvironmentDataBlock`) designed to specify the path to an icon file that is to be displayed for the LNK file within a host directory. 

Adversaries may abuse this LNK metadata to download malicious payloads. For example, adversaries have been observed using LNK files as phishing payloads to deliver malware. Once invoked (e.g., Malicious File), payloads referenced via external URLs within the LNK icon location field may be downloaded. These files may also then be invoked by Command and Scripting Interpreter/System Binary Proxy Execution arguments within the target path field of the LNK.

LNK Icon Smuggling may also be utilized post compromise, such as malicious scripts executing an LNK on an infected host to download additional malicious payloads.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if LNK Icon Smuggling technique is applicable to target environment
- [ ] Check Windows systems for indicators of LNK Icon Smuggling
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to LNK Icon Smuggling by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1049 Antivirus/Antimalware
Use signatures or heuristics to detect malicious LNK and subsequently downloaded files.

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent execution of potentially obfuscated scripts or payloads.


## Detection

### Detection Strategy for LNK Icon Smuggling


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| LNK Icon Smuggling technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Unprotect Shortcut](https://unprotect.it/technique/shortcut-hiding/)
- [Booby Trap Shortcut 2017](https://www.uperesia.com/booby-trapped-shortcut)
- [Atomic Red Team - T1027.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.012)
- [MITRE ATT&CK - T1027.012](https://attack.mitre.org/techniques/T1027/012)
