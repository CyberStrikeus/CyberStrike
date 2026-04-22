---
name: "T1564.009_resource-forking"
description: "Adversaries may abuse resource forks to hide malicious code or executables to evade detection and bypass security applications."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1564.009
  - defense-evasion
  - macos
  - sub-technique
technique_id: "T1564.009"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1564/009"
tech_stack:
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
  - T1564.007
  - T1564.008
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

# T1564.009 Resource Forking

> **Sub-technique of:** T1564

## High-Level Description

Adversaries may abuse resource forks to hide malicious code or executables to evade detection and bypass security applications. A resource fork provides applications a structured way to store resources such as thumbnail images, menu definitions, icons, dialog boxes, and code. Usage of a resource fork is identifiable when displaying a file’s extended attributes, using <code>ls -l@</code> or <code>xattr -l</code> commands. Resource forks have been deprecated and replaced with the application bundle structure. Non-localized resources are placed at the top level directory of an application bundle, while localized resources are placed in the <code>/Resources</code> folder.

Adversaries can use resource forks to hide malicious data that may otherwise be stored directly in files. Adversaries can execute content with an attached resource fork, at a specified offset, that is moved to an executable location then invoked. Resource fork content may also be obfuscated/encrypted until execution.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** macOS

## What to Check

- [ ] Identify if Resource Forking technique is applicable to target environment
- [ ] Check macOS systems for indicators of Resource Forking
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Resource Forking by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1564.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1013 Application Developer Guidance

Configure applications to use the application bundle structure which leverages the <code>/Resources</code> folder location.

## Detection

### Detection Strategy for Resource Forking on macOS

## Risk Assessment

| Finding                               | Severity | Impact          |
| ------------------------------------- | -------- | --------------- |
| Resource Forking technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [tau bundlore erika noerenberg 2020](https://blogs.vmware.com/security/2020/06/tau-threat-analysis-bundlore-macos-mm-install-macos.html)
- [Resource and Data Forks](https://flylib.com/books/en/4.395.1.192/1/)
- [ELC Extended Attributes](https://eclecticlight.co/2020/10/24/theres-more-to-files-than-data-extended-attributes/)
- [sentinellabs resource named fork 2020](https://www.sentinelone.com/labs/resourceful-macos-malware-hides-in-named-fork/)
- [macOS Hierarchical File System Overview](http://tenon.com/products/codebuilder/User_Guide/6_File_Systems.html#anchor520553)
- [Atomic Red Team - T1564.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1564.009)
- [MITRE ATT&CK - T1564.009](https://attack.mitre.org/techniques/T1564/009)
