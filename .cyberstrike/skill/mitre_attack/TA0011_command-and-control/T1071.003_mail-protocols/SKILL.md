---
name: "T1071.003_mail-protocols"
description: "Adversaries may communicate using application layer protocols associated with electronic mail delivery to avoid detection/network filtering by blending in with existing traffic."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1071.003
  - command-and-control
  - linux
  - macos
  - network-devices
  - windows
  - sub-technique
technique_id: "T1071.003"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1071/003"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-300
chains_with:
  - T1071
  - T1071.001
  - T1071.002
  - T1071.004
  - T1071.005
prerequisites:
  - T1071
severity_boost:
  T1071: "Chain with T1071 for deeper attack path"
  T1071.001: "Chain with T1071.001 for deeper attack path"
  T1071.002: "Chain with T1071.002 for deeper attack path"
---

# T1071.003 Mail Protocols

> **Sub-technique of:** T1071

## High-Level Description

Adversaries may communicate using application layer protocols associated with electronic mail delivery to avoid detection/network filtering by blending in with existing traffic. Commands to the remote system, and often the results of those commands, will be embedded within the protocol traffic between the client and server. 

Protocols such as SMTP/S, POP3/S, and IMAP that carry electronic mail may be very common in environments. Packets produced from these protocols may have many fields and headers in which data can be concealed. Data could also be concealed within the email messages themselves. An adversary may abuse these protocols to communicate with systems under their control within a victim network while also mimicking normal, expected traffic.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Mail Protocols technique is applicable to target environment
- [ ] Check Linux systems for indicators of Mail Protocols
- [ ] Check macOS systems for indicators of Mail Protocols
- [ ] Check Network Devices systems for indicators of Mail Protocols
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Mail Protocols by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1071.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic
Limit the ability of servers and critical systems to initiate outbound email communications. Filtering SMTP/IMAP/POP3 traffic to only trusted mail servers reduces the risk of attackers using compromised systems to exfiltrate data via email or to receive commands from attacker-controlled email accounts.

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.


## Detection

### Detection of Mail Protocol-Based C2 Activity (SMTP, IMAP, POP3)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Mail Protocols technique applicable | Low | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [FireEye APT28](https://web.archive.org/web/20151022204649/https://www.fireeye.com/content/dam/fireeye-www/global/en/current-threats/pdfs/rpt-apt28.pdf)
- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Atomic Red Team - T1071.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1071.003)
- [MITRE ATT&CK - T1071.003](https://attack.mitre.org/techniques/T1071/003)
