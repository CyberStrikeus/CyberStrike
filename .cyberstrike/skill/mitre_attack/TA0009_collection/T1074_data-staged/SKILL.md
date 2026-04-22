---
name: "T1074_data-staged"
description: "Adversaries may stage collected data in a central location or directory prior to Exfiltration."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1074
  - collection
  - windows
  - iaas
  - linux
  - macos
  - esxi
technique_id: "T1074"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1074"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
  - esxi
cwe_ids:
  - CWE-200
chains_with:
  - T1074.001
  - T1074.002
prerequisites: []
severity_boost:
  T1074.001: "Chain with T1074.001 for deeper attack path"
  T1074.002: "Chain with T1074.002 for deeper attack path"
---

# T1074 Data Staged

## High-Level Description

Adversaries may stage collected data in a central location or directory prior to Exfiltration. Data may be kept in separate files or combined into one file through techniques such as Archive Collected Data. Interactive command shells may be used, and common functionality within cmd and bash may be used to copy data into a staging location.

In cloud environments, adversaries may stage data within a particular instance or virtual machine before exfiltration. An adversary may Create Cloud Instance and stage data in that instance.

Adversaries may choose to stage data from a victim network in a centralized location prior to Exfiltration to minimize the number of connections made to their C2 server and better evade detection.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Windows, IaaS, Linux, macOS, ESXi

## What to Check

- [ ] Identify if Data Staged technique is applicable to target environment
- [ ] Check Windows systems for indicators of Data Staged
- [ ] Check IaaS systems for indicators of Data Staged
- [ ] Check Linux systems for indicators of Data Staged
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data Staged by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1074 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection of Data Staging Prior to Exfiltration

## Risk Assessment

| Finding                          | Severity | Impact     |
| -------------------------------- | -------- | ---------- |
| Data Staged technique applicable | Low      | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Mandiant M-Trends 2020](https://www.mandiant.com/sites/default/files/2021-09/mtrends-2020.pdf)
- [PWC Cloud Hopper April 2017](https://web.archive.org/web/20220224041316/https:/www.pwc.co.uk/cyber-security/pdf/cloud-hopper-report-final-v4.pdf)
- [Atomic Red Team - T1074](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1074)
- [MITRE ATT&CK - T1074](https://attack.mitre.org/techniques/T1074)
