---
name: "T1071.002_file-transfer-protocols"
description: "Adversaries may communicate using application layer protocols associated with transferring files to avoid detection/network filtering by blending in with existing traffic."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1071.002
  - command-and-control
  - esxi
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1071.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1071/002"
tech_stack:
  - esxi
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1071
  - T1071.001
  - T1071.003
  - T1071.004
  - T1071.005
prerequisites:
  - T1071
severity_boost:
  T1071: "Chain with T1071 for deeper attack path"
  T1071.001: "Chain with T1071.001 for deeper attack path"
  T1071.003: "Chain with T1071.003 for deeper attack path"
---

# T1071.002 File Transfer Protocols

> **Sub-technique of:** T1071

## High-Level Description

Adversaries may communicate using application layer protocols associated with transferring files to avoid detection/network filtering by blending in with existing traffic. Commands to the remote system, and often the results of those commands, will be embedded within the protocol traffic between the client and server.

Protocols such as SMB, FTP, FTPS, and TFTP that transfer files may be very common in environments. Packets produced from these protocols may have many fields and headers in which data can be concealed. Data could also be concealed within the transferred files. An adversary may abuse these protocols to communicate with systems under their control within a victim network while also mimicking normal, expected traffic.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if File Transfer Protocols technique is applicable to target environment
- [ ] Check ESXi systems for indicators of File Transfer Protocols
- [ ] Check Linux systems for indicators of File Transfer Protocols
- [ ] Check macOS systems for indicators of File Transfer Protocols
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to File Transfer Protocols by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1071.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Filter outbound FTP/SFTP traffic from sensitive systems, allowing file transfers only to trusted internal or known IP addresses. This measure can prevent attackers from transferring data or payloads via FTP/SFTP channels to or from unauthorized external systems.

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

## Detection

### Detection of File Transfer Protocol-Based C2 (FTP, FTPS, SMB, TFTP)

## Risk Assessment

| Finding                                      | Severity | Impact              |
| -------------------------------------------- | -------- | ------------------- |
| File Transfer Protocols technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [ESET Machete July 2019](https://www.welivesecurity.com/wp-content/uploads/2019/08/ESET_Machete.pdf)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [US-CERT TA18-074A](https://www.us-cert.gov/ncas/alerts/TA18-074A)
- [Atomic Red Team - T1071.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1071.002)
- [MITRE ATT&CK - T1071.002](https://attack.mitre.org/techniques/T1071/002)
