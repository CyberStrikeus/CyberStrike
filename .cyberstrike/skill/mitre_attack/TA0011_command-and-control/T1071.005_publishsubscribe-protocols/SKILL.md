---
name: "T1071.005_publishsubscribe-protocols"
description: "Adversaries may communicate using publish/subscribe (pub/sub) application layer protocols to avoid detection/network filtering by blending in with existing traffic."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1071.005
  - command-and-control
  - macos
  - linux
  - windows
  - network-devices
  - sub-technique
technique_id: "T1071.005"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - macOS
  - Linux
  - Windows
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1071/005"
tech_stack:
  - macos
  - linux
  - windows
  - network devices
cwe_ids:
  - CWE-300
chains_with:
  - T1071
  - T1071.001
  - T1071.002
  - T1071.003
  - T1071.004
prerequisites:
  - T1071
severity_boost:
  T1071: "Chain with T1071 for deeper attack path"
  T1071.001: "Chain with T1071.001 for deeper attack path"
  T1071.002: "Chain with T1071.002 for deeper attack path"
---

# T1071.005 Publish/Subscribe Protocols

> **Sub-technique of:** T1071

## High-Level Description

Adversaries may communicate using publish/subscribe (pub/sub) application layer protocols to avoid detection/network filtering by blending in with existing traffic. Commands to the remote system, and often the results of those commands, will be embedded within the protocol traffic between the client and server.

Protocols such as <code>MQTT</code>, <code>XMPP</code>, <code>AMQP</code>, and <code>STOMP</code> use a publish/subscribe design, with message distribution managed by a centralized broker. Publishers categorize their messages by topics, while subscribers receive messages according to their subscribed topics. An adversary may abuse publish/subscribe protocols to communicate with systems under their control from behind a message broker while also mimicking normal, expected traffic.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** macOS, Linux, Windows, Network Devices

## What to Check

- [ ] Identify if Publish/Subscribe Protocols technique is applicable to target environment
- [ ] Check macOS systems for indicators of Publish/Subscribe Protocols
- [ ] Check Linux systems for indicators of Publish/Subscribe Protocols
- [ ] Check Windows systems for indicators of Publish/Subscribe Protocols
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Publish/Subscribe Protocols by examining the target platforms (macOS, Linux, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1071.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Consider filtering publish/subscribe protocol requests to untrusted or known bad resources over irregular ports (e.g. MQTT’s standard ports are 1883 or 8883).

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific adversary malware can be used to mitigate activity at the network level.

## Detection

### Behavioral Detection of Publish/Subscribe Protocol Misuse for C2

## Risk Assessment

| Finding                                          | Severity | Impact              |
| ------------------------------------------------ | -------- | ------------------- |
| Publish/Subscribe Protocols technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [wailing crab sub/pub](https://securityintelligence.com/x-force/wailingcrab-malware-misues-mqtt-messaging-protocol/)
- [Mandiant APT1 Appendix](https://www.mandiant.com/sites/default/files/2021-09/mandiant-apt1-report.pdf)
- [Atomic Red Team - T1071.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1071.005)
- [MITRE ATT&CK - T1071.005](https://attack.mitre.org/techniques/T1071/005)
