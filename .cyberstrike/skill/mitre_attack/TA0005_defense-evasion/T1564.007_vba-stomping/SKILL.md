---
name: "T1564.007_vba-stomping"
description: "Adversaries may hide malicious Visual Basic for Applications (VBA) payloads embedded within MS Office documents by replacing the VBA source code with benign data."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.007
  - defense-evasion
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1564.007"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1564/007"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1564
  - T1564.001
  - T1564.002
  - T1564.003
  - T1564.004
  - T1564.005
  - T1564.006
  - T1564.008
  - T1564.009
  - T1564.010
  - T1564.011
  - T1564.012
  - T1564.013
  - T1564.014
prerequisites:
  - T1564
severity_boost:
  T1564: "Chain with T1564 for deeper attack path"
  T1564.001: "Chain with T1564.001 for deeper attack path"
  T1564.002: "Chain with T1564.002 for deeper attack path"
---

# T1564.007 VBA Stomping

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may hide malicious Visual Basic for Applications (VBA) payloads embedded within MS Office documents by replacing the VBA source code with benign data.

MS Office documents with embedded VBA content store source code inside of module streams. Each module stream has a <code>PerformanceCache</code> that stores a separate compiled version of the VBA source code known as p-code. The p-code is executed when the MS Office version specified in the <code>\_VBA_PROJECT</code> stream (which contains the version-dependent description of the VBA project) matches the version of the host MS Office application.

An adversary may hide malicious VBA code by overwriting the VBA source code location with zero’s, benign code, or random bytes while leaving the previously compiled malicious p-code. Tools that scan for malicious VBA source code may be bypassed as the unwanted code is hidden in the compiled p-code. If the VBA source code is removed, some tools might even think that there are no macros present. If there is a version match between the <code>\_VBA_PROJECT</code> stream and host MS Office application, the p-code will be executed, otherwise the benign VBA source code will be decompressed and recompiled to p-code, thus removing malicious p-code and potentially bypassing dynamic analysis.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if VBA Stomping technique is applicable to target environment
- [ ] Check Linux systems for indicators of VBA Stomping
- [ ] Check Windows systems for indicators of VBA Stomping
- [ ] Check macOS systems for indicators of VBA Stomping
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to VBA Stomping by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.007 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Turn off or restrict access to unneeded VB components.

## Detection

### Detection Strategy for VBA Stomping

## Risk Assessment

| Finding                           | Severity | Impact          |
| --------------------------------- | -------- | --------------- |
| VBA Stomping technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [FireEye VBA stomp Feb 2020](https://www.fireeye.com/blog/threat-research/2020/01/stomp-2-dis-brilliance-in-the-visual-basics.html)
- [Evil Clippy May 2019](https://outflank.nl/blog/2019/05/05/evil-clippy-ms-office-maldoc-assistant/)
- [Microsoft \_VBA_PROJECT Stream](https://docs.microsoft.com/en-us/openspecs/office_file_formats/ms-ovba/ef7087ac-3974-4452-aab2-7dba2214d239)
- [Walmart Roberts Oct 2018](https://medium.com/walmartglobaltech/vba-stomping-advanced-maldoc-techniques-612c484ab278)
- [pcodedmp Bontchev](https://github.com/bontchev/pcodedmp)
- [oletools toolkit](https://github.com/decalage2/oletools)
- [Atomic Red Team - T1564.007](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.007)
- [MITRE ATT&CK - T1564.007](https://attack.mitre.org/techniques/T1564/007)
