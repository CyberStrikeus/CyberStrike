---
name: "T1205.001_port-knocking"
description: "Adversaries may use port knocking to hide open ports used for persistence or command and control."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1205.001
  - defense-evasion
  - persistence
  - command-and-control
  - linux
  - macos
  - windows
  - network-devices
  - sub-technique
technique_id: "T1205.001"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1205/001"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
cwe_ids:
  - CWE-693
chains_with:
  - T1205
  - T1205.002
prerequisites:
  - T1205
severity_boost:
  T1205: "Chain with T1205 for deeper attack path"
  T1205.002: "Chain with T1205.002 for deeper attack path"
---

# T1205.001 Port Knocking

> **Sub-technique of:** T1205

## High-Level Description

Adversaries may use port knocking to hide open ports used for persistence or command and control. To enable a port, an adversary sends a series of attempted connections to a predefined sequence of closed ports. After the sequence is completed, opening a port is often accomplished by the host based firewall, but could also be implemented by custom software.

This technique has been observed both for the dynamic opening of a listening port as well as the initiating of a connection to a listening server on a different system.

The observation of the signal packets to trigger the communication can be conducted through different methods. One means, originally implemented by Cd00r , is to use the libpcap libraries to sniff for the packets in question. Another method leverages raw sockets, which enables the malware to use ports that are already open for use by other programs.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)
- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, Network Devices

## What to Check

- [ ] Identify if Port Knocking technique is applicable to target environment
- [ ] Check Linux systems for indicators of Port Knocking
- [ ] Check macOS systems for indicators of Port Knocking
- [ ] Check Windows systems for indicators of Port Knocking
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Port Knocking by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1205.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic
Mitigation of some variants of this technique could be achieved through the use of stateful firewalls, depending upon how it is implemented.


## Detection

### Port-knock → rule/daemon change → first successful connect (T1205.001)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Port Knocking technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Hartrell cd00r 2002](https://www.giac.org/paper/gcih/342/handle-cd00r-invisible-backdoor/103631)
- [Atomic Red Team - T1205.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1205.001)
- [MITRE ATT&CK - T1205.001](https://attack.mitre.org/techniques/T1205/001)
