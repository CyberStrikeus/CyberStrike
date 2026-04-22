---
name: "T0867_lateral-tool-transfer"
description: "Adversaries may transfer tools or other files from one system to another to stage adversary tools or other files over the course of an operation."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0867
  - lateral-movement
technique_id: "T0867"
tactic: "lateral-movement"
all_tactics:
  - lateral-movement
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0867"
tech_stack:
  - ics
cwe_ids:
  - CWE-284
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0867 Lateral Tool Transfer

## High-Level Description

Adversaries may transfer tools or other files from one system to another to stage adversary tools or other files over the course of an operation. Copying of files may also be performed laterally between internal victim systems to support Lateral Movement with remote Execution using inherent file sharing protocols such as file sharing over SMB to connected network shares. 

In control systems environments, malware may use SMB and other file sharing protocols to move laterally through industrial networks.

## Kill Chain Phase

- Lateral Movement (TA0109)

**Platforms:** ICS

## What to Check

- [ ] Identify if Lateral Tool Transfer technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Lateral Tool Transfer
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Lateral Tool Transfer by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0867 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0931 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware or unusual data transfer over known tools and protocols like FTP can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific obfuscation technique used by a particular adversary or tool and will likely be different across various malware families and versions. Adversaries will likely change tool C2 signatures over time or construct protocols in such a way as to avoid detection by common defensive tools.


## Detection

### Detection of Lateral Tool Transfer


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Lateral Tool Transfer technique applicable | Low | Lateral Movement |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-284 | Improper Access Control |


## References

- [Enterprise ATT&CK](https://attack.mitre.org/techniques/T1570/)
- [MITRE ATT&CK ICS - T0867](https://attack.mitre.org/techniques/T0867)
