---
name: "T1090.002_external-proxy"
description: "Adversaries may use an external proxy to act as an intermediary for network communications to a command and control server to avoid direct connections to their infrastructure."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1090.002
  - command-and-control
  - esxi
  - linux
  - network-devices
  - windows
  - macos
  - sub-technique
technique_id: "T1090.002"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - ESXi
  - Linux
  - Network Devices
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1090/002"
tech_stack:
  - esxi
  - linux
  - network devices
  - windows
  - macos
cwe_ids:
  - CWE-300
chains_with:
  - T1090
  - T1090.001
  - T1090.003
  - T1090.004
prerequisites:
  - T1090
severity_boost:
  T1090: "Chain with T1090 for deeper attack path"
  T1090.001: "Chain with T1090.001 for deeper attack path"
  T1090.003: "Chain with T1090.003 for deeper attack path"
---

# T1090.002 External Proxy

> **Sub-technique of:** T1090

## High-Level Description

Adversaries may use an external proxy to act as an intermediary for network communications to a command and control server to avoid direct connections to their infrastructure. Many tools exist that enable traffic redirection through proxies or port redirection, including HTRAN, ZXProxy, and ZXPortMap. Adversaries use these types of proxies to manage command and control communications, to provide resiliency in the face of connection loss, or to ride over existing trusted communications paths to avoid suspicion.

External connection proxies are used to mask the destination of C2 traffic and are typically implemented with port redirectors. Compromised systems outside of the victim environment may be used for these purposes, as well as purchased infrastructure such as cloud-based resources or virtual private servers. Proxies may be chosen based on the low likelihood that a connection to them from a compromised system would be investigated. Victim systems would communicate directly with the external proxy on the Internet and then the proxy would forward communications to the C2 server.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** ESXi, Linux, Network Devices, Windows, macOS

## What to Check

- [ ] Identify if External Proxy technique is applicable to target environment
- [ ] Check ESXi systems for indicators of External Proxy
- [ ] Check Linux systems for indicators of External Proxy
- [ ] Check Network Devices systems for indicators of External Proxy
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to External Proxy by examining the target platforms (ESXi, Linux, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1090.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific C2 protocol used by a particular adversary or tool, and will likely be different across various malware families and versions. Adversaries will likely change tool C2 signatures over time or construct protocols in such a way as to avoid detection by common defensive tools.


## Detection

### External Proxy Behavior via Outbound Relay to Intermediate Infrastructure


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| External Proxy technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [University of Birmingham C2](https://arxiv.org/ftp/arxiv/papers/1408/1408.1136.pdf)
- [Trend Micro APT Attack Tools](http://blog.trendmicro.com/trendlabs-security-intelligence/in-depth-look-apt-attack-tools-of-the-trade/)
- [Atomic Red Team - T1090.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1090.002)
- [MITRE ATT&CK - T1090.002](https://attack.mitre.org/techniques/T1090/002)
