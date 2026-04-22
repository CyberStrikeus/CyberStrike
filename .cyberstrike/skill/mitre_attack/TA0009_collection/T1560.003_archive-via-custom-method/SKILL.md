---
name: "T1560.003_archive-via-custom-method"
description: "An adversary may compress or encrypt data that is collected prior to exfiltration using a custom method."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1560.003
  - collection
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1560.003"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1560/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1560
  - T1560.001
  - T1560.002
prerequisites:
  - T1560
severity_boost:
  T1560: "Chain with T1560 for deeper attack path"
  T1560.001: "Chain with T1560.001 for deeper attack path"
  T1560.002: "Chain with T1560.002 for deeper attack path"
---

# T1560.003 Archive via Custom Method

> **Sub-technique of:** T1560

## High-Level Description

An adversary may compress or encrypt data that is collected prior to exfiltration using a custom method. Adversaries may choose to use custom archival methods, such as encryption with XOR or stream ciphers implemented with no external library or utility references. Custom implementations of well-known compression algorithms have also been used.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Archive via Custom Method technique is applicable to target environment
- [ ] Check Linux systems for indicators of Archive via Custom Method
- [ ] Check macOS systems for indicators of Archive via Custom Method
- [ ] Check Windows systems for indicators of Archive via Custom Method
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Archive via Custom Method by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1560.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Archiving via Custom Method (T1560.003)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Archive via Custom Method technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [ESET Sednit Part 2](http://www.welivesecurity.com/wp-content/uploads/2016/10/eset-sednit-part-2.pdf)
- [Atomic Red Team - T1560.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1560.003)
- [MITRE ATT&CK - T1560.003](https://attack.mitre.org/techniques/T1560/003)
