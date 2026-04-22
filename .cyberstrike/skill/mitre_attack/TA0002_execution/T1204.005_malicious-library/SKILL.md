---
name: "T1204.005_malicious-library"
description: "Adversaries may rely on a user installing a malicious library to facilitate execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1204.005
  - execution
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1204.005"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1204/005"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1204
  - T1204.001
  - T1204.002
  - T1204.003
  - T1204.004
prerequisites:
  - T1204
severity_boost:
  T1204: "Chain with T1204 for deeper attack path"
  T1204.001: "Chain with T1204.001 for deeper attack path"
  T1204.002: "Chain with T1204.002 for deeper attack path"
---

# T1204.005 Malicious Library

> **Sub-technique of:** T1204

## High-Level Description

Adversaries may rely on a user installing a malicious library to facilitate execution. Threat actors may Upload Malware to package managers such as NPM and PyPi, as well as to public code repositories such as GitHub. User may install libraries without realizing they are malicious, thus bypassing techniques that specifically achieve Initial Access. This can lead to the execution of malicious code, such as code that establishes persistence, steals data, or mines cryptocurrency.

In some cases, threat actors may compromise and backdoor existing popular libraries (i.e., Compromise Software Dependencies and Development Tools). Alternatively, they may create entirely new packages and leverage behaviors such as typosquatting to encourage users to install them.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Malicious Library technique is applicable to target environment
- [ ] Check Linux systems for indicators of Malicious Library
- [ ] Check macOS systems for indicators of Malicious Library
- [ ] Check Windows systems for indicators of Malicious Library
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Malicious Library by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1204.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1033 Limit Software Installation

Where possible, consider requiring developers to pull from internal repositories containing verified and approved packages rather than from external ones.

### M1031 Network Intrusion Prevention

Network prevention intrusion systems and systems designed to scan and remove malicious downloads can be used to block activity.

### M1017 User Training

Train developers to be aware of the existence of malicious libraries and how to avoid installing them.

## Detection

### User-Initiated Malicious Library Installation via Package Manager (T1204.005)

## Risk Assessment

| Finding                                | Severity | Impact    |
| -------------------------------------- | -------- | --------- |
| Malicious Library technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Datadog Security Labs Malicious PyPi Packages 2024](https://securitylabs.datadoghq.com/articles/malicious-pypi-package-targeting-highly-specific-macos-machines/)
- [Fortinet Malicious NPM Packages 2023](https://www.fortinet.com/blog/threat-research/malicious-packages-hiddin-in-npm)
- [Atomic Red Team - T1204.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1204.005)
- [MITRE ATT&CK - T1204.005](https://attack.mitre.org/techniques/T1204/005)
