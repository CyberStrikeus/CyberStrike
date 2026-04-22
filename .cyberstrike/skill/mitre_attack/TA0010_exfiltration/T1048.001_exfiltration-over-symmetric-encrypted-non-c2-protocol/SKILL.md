---
name: "T1048.001_exfiltration-over-symmetric-encrypted-non-c2-protocol"
description: "Adversaries may steal data by exfiltrating it over a symmetrically encrypted network protocol other than that of the existing command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1048.001
  - exfiltration
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1048.001"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1048/001"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-200
chains_with:
  - T1048
  - T1048.002
  - T1048.003
prerequisites:
  - T1048
severity_boost:
  T1048: "Chain with T1048 for deeper attack path"
  T1048.002: "Chain with T1048.002 for deeper attack path"
  T1048.003: "Chain with T1048.003 for deeper attack path"
---

# T1048.001 Exfiltration Over Symmetric Encrypted Non-C2 Protocol

> **Sub-technique of:** T1048

## High-Level Description

Adversaries may steal data by exfiltrating it over a symmetrically encrypted network protocol other than that of the existing command and control channel. The data may also be sent to an alternate network location from the main command and control server. 

Symmetric encryption algorithms are those that use shared or the same keys/secrets on each end of the channel. This requires an exchange or pre-arranged agreement/possession of the value used to encrypt and decrypt data. 

Network protocols that use asymmetric encryption often utilize symmetric encryption once keys are exchanged, but adversaries may opt to manually share keys and implement symmetric cryptographic algorithms (ex: RC4, AES) vice using mechanisms that are baked into a protocol. This may result in multiple layers of encryption (in protocols that are natively encrypted such as HTTPS) or encryption in protocols that not typically encrypted (such as HTTP or FTP).

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Exfiltration Over Symmetric Encrypted Non-C2 Protocol technique is applicable to target environment
- [ ] Check Linux systems for indicators of Exfiltration Over Symmetric Encrypted Non-C2 Protocol
- [ ] Check macOS systems for indicators of Exfiltration Over Symmetric Encrypted Non-C2 Protocol
- [ ] Check Windows systems for indicators of Exfiltration Over Symmetric Encrypted Non-C2 Protocol
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration Over Symmetric Encrypted Non-C2 Protocol by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1048.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic
Enforce proxies and use dedicated servers for services such as DNS and only allow those systems to communicate over respective ports/protocols, instead of all systems within a network.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary command and control infrastructure and malware can be used to mitigate activity at the network level.

### M1030 Network Segmentation
Follow best practices for network firewall configurations to allow only necessary ports and traffic to enter and exit the network.


## Detection

### Behavioral Detection Strategy for Exfiltration Over Symmetric Encrypted Non-C2 Protocol


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Exfiltration Over Symmetric Encrypted Non-C2 Protocol technique applicable | Low | Exfiltration |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1048.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1048.001)
- [MITRE ATT&CK - T1048.001](https://attack.mitre.org/techniques/T1048/001)
