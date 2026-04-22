---
name: "T1039_data-from-network-shared-drive"
description: "Adversaries may search network shares on computers they have compromised to find files of interest."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1039
  - collection
  - linux
  - macos
  - windows
technique_id: "T1039"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1039"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1039 Data from Network Shared Drive

## High-Level Description

Adversaries may search network shares on computers they have compromised to find files of interest. Sensitive data can be collected from remote systems via shared network drives (host shared directory, network file server, etc.) that are accessible from the current system prior to Exfiltration. Interactive command shells may be in use, and common functionality within cmd may be used to gather information.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Data from Network Shared Drive technique is applicable to target environment
- [ ] Check Linux systems for indicators of Data from Network Shared Drive
- [ ] Check macOS systems for indicators of Data from Network Shared Drive
- [ ] Check Windows systems for indicators of Data from Network Shared Drive
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Copy a sensitive File over Administrative share with copy

Copy from sensitive File from the c$ of another LAN computer with copy cmd
https://twitter.com/SBousseaden/status/1211636381086339073

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
copy \\#{remote}\C$\#{share_file} %TEMP%\#{local_file}
```

**Dependencies:**
- Administrative share must exist on #{remote}
- "\\#{remote}\C$\#{share_file}" must exist on #{remote}

### Atomic Test 2: Copy a sensitive File over Administrative share with Powershell

Copy from sensitive File from the c$ of another LAN computer with powershell
https://twitter.com/SBousseaden/status/1211636381086339073

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
copy-item -Path "\\#{remote}\C$\#{share_file}" -Destination "$Env:TEMP\#{local_file}"
```

**Dependencies:**
- Administrative share must exist on #{remote}
- "\\#{remote}\C$\#{share_file}" must exist on #{remote}


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data from Network Shared Drive by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1039 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Data from Network Shared Drive


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data from Network Shared Drive technique applicable | Low | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Atomic Red Team - T1039](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1039)
- [MITRE ATT&CK - T1039](https://attack.mitre.org/techniques/T1039)
