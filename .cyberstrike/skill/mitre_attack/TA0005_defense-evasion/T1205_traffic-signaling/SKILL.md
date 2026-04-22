---
name: "T1205_traffic-signaling"
description: "Adversaries may use traffic signaling to hide open ports or other malicious functionality used for persistence or command and control."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1205
  - defense-evasion
  - persistence
  - command-and-control
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1205"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
  - command-and-control
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1205"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1205.001
  - T1205.002
prerequisites: []
severity_boost:
  T1205.001: "Chain with T1205.001 for deeper attack path"
  T1205.002: "Chain with T1205.002 for deeper attack path"
---

# T1205 Traffic Signaling

## High-Level Description

Adversaries may use traffic signaling to hide open ports or other malicious functionality used for persistence or command and control. Traffic signaling involves the use of a magic value or sequence that must be sent to a system to trigger a special response, such as opening a closed port or executing a malicious task. This may take the form of sending a series of packets with certain characteristics before a port will be opened that the adversary can use for command and control. Usually this series of packets consists of attempted connections to a predefined sequence of closed ports (i.e. Port Knocking), but can involve unusual flags, specific strings, or other unique characteristics. After the sequence is completed, opening a port may be accomplished by the host-based firewall, but could also be implemented by custom software.

Adversaries may also communicate with an already open port, but the service listening on that port will only respond to commands or trigger other malicious functionality if passed the appropriate magic value(s).

The observation of the signal packets to trigger the communication can be conducted through different methods. One means, originally implemented by Cd00r , is to use the libpcap libraries to sniff for the packets in question. Another method leverages raw sockets, which enables the malware to use ports that are already open for use by other programs.

On network devices, adversaries may use crafted packets to enable Network Device Authentication for standard services offered by the device such as telnet. Such signaling may also be used to open a closed service port such as telnet, or to trigger module modification of malware implants on the device, adding, removing, or changing malicious capabilities. Adversaries may use crafted packets to attempt to connect to one or more (open or closed) ports, but may also attempt to connect to a router interface, broadcast, and network address IP on the same port in order to achieve their goals and objectives. To enable this traffic signaling on embedded devices, adversaries must first achieve and leverage Patch System Image due to the monolithic nature of the architecture.

Adversaries may also use the Wake-on-LAN feature to turn on powered off systems. Wake-on-LAN is a hardware feature that allows a powered down system to be powered on, or woken up, by sending a magic packet to it. Once the system is powered on, it may become a target for lateral movement.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)
- Command and Control (TA0011)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Traffic Signaling technique is applicable to target environment
- [ ] Check Linux systems for indicators of Traffic Signaling
- [ ] Check macOS systems for indicators of Traffic Signaling
- [ ] Check Network Devices systems for indicators of Traffic Signaling
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Traffic Signaling by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1205 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Mitigation of some variants of this technique could be achieved through the use of stateful firewalls, depending upon how it is implemented.

### M1042 Disable or Remove Feature or Program

Disable Wake-on-LAN if it is not needed within an environment.

## Detection

### Traffic Signaling (Port-knock / magic-packet → firewall or service activation) – T1205

## Risk Assessment

| Finding                                | Severity | Impact          |
| -------------------------------------- | -------- | --------------- |
| Traffic Signaling technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Bleeping Computer - Ryuk WoL](https://www.bleepingcomputer.com/news/security/ryuk-ransomware-uses-wake-on-lan-to-encrypt-offline-devices/)
- [AMD Magic Packet](https://www.amd.com/system/files/TechDocs/20213.pdf)
- [Mandiant - Synful Knock](https://cloud.google.com/blog/topics/threat-intelligence/synful-knock-acis/)
- [Cisco Synful Knock Evolution](https://blogs.cisco.com/security/evolution-of-attacks-on-cisco-ios-devices)
- [Hartrell cd00r 2002](https://www.giac.org/paper/gcih/342/handle-cd00r-invisible-backdoor/103631)
- [Cisco Blog Legacy Device Attacks](https://community.cisco.com/t5/security-blogs/attackers-continue-to-target-legacy-devices/ba-p/4169954)
- [GitLab WakeOnLAN](https://gitlab.com/wireshark/wireshark/-/wikis/WakeOnLAN)
- [Atomic Red Team - T1205](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1205)
- [MITRE ATT&CK - T1205](https://attack.mitre.org/techniques/T1205)
