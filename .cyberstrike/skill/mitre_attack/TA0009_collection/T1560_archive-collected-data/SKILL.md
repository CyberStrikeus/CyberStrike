---
name: "T1560_archive-collected-data"
description: "An adversary may compress and/or encrypt data that is collected prior to exfiltration."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1560
  - collection
  - linux
  - macos
  - windows
technique_id: "T1560"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1560"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1560.001
  - T1560.002
  - T1560.003
prerequisites: []
severity_boost:
  T1560.001: "Chain with T1560.001 for deeper attack path"
  T1560.002: "Chain with T1560.002 for deeper attack path"
  T1560.003: "Chain with T1560.003 for deeper attack path"
---

# T1560 Archive Collected Data

## High-Level Description

An adversary may compress and/or encrypt data that is collected prior to exfiltration. Compressing the data can help to obfuscate the collected data and minimize the amount of data sent over the network. Encryption can be used to hide information that is being exfiltrated from detection or make exfiltration less conspicuous upon inspection by a defender.

Both compression and encryption are done prior to exfiltration, and can be performed using a utility, 3rd party library, or custom method.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Archive Collected Data technique is applicable to target environment
- [ ] Check Linux systems for indicators of Archive Collected Data
- [ ] Check macOS systems for indicators of Archive Collected Data
- [ ] Check Windows systems for indicators of Archive Collected Data
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Compress Data for Exfiltration With PowerShell

An adversary may compress data (e.g., sensitive documents) that is collected prior to exfiltration.
When the test completes you should find the files from the $env:USERPROFILE directory compressed in a file called T1560-data-ps.zip in the $env:USERPROFILE directory

**Supported Platforms:** windows

```powershell
dir #{input_file} -Recurse | Compress-Archive -DestinationPath #{output_file}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Archive Collected Data by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1560 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit

System scans can be performed to identify unauthorized archival utilities.

## Detection

### Detect Archiving and Encryption of Collected Data (T1560)

## Risk Assessment

| Finding                                     | Severity | Impact     |
| ------------------------------------------- | -------- | ---------- |
| Archive Collected Data technique applicable | Medium   | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [DOJ GRU Indictment Jul 2018](https://cdn.cnn.com/cnn/2018/images/07/13/gru.indictment.pdf)
- [Wikipedia File Header Signatures](https://en.wikipedia.org/wiki/List_of_file_signatures)
- [Atomic Red Team - T1560](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1560)
- [MITRE ATT&CK - T1560](https://attack.mitre.org/techniques/T1560)
