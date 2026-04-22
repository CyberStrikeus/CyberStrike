---
name: "T0842_network-sniffing"
description: "Network sniffing is the practice of using a network interface on a computer system to monitor or capture information regardless of whether it is the specified destination for the information."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0842
  - discovery
technique_id: "T0842"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0842"
tech_stack:
  - ics
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0842 Network Sniffing

## High-Level Description

Network sniffing is the practice of using a network interface on a computer system to monitor or capture information regardless of whether it is the specified destination for the information.

An adversary may attempt to sniff the traffic to gain information about the target. This information can vary in the level of importance. Relatively unimportant information is general communications to and from machines. Relatively important information would be login information. User credentials may be sent over an unencrypted protocol, such as Telnet, that can be captured and obtained through network packet analysis.

In addition, ARP and Domain Name Service (DNS) poisoning can be used to capture credentials to websites, proxies, and internal systems by redirecting traffic to an adversary.

## Kill Chain Phase

- Discovery (TA0102)

**Platforms:** ICS

## What to Check

- [ ] Identify if Network Sniffing technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Network Sniffing
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Network Sniffing by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0842 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0926 Privileged Account Management

Restrict root or administrator access on user accounts to limit the ability to capture promiscuous traffic on a network through common packet capture tools.

### M0930 Network Segmentation

Segment networks and systems appropriately to reduce access to critical system and services communications.

### M0932 Multi-factor Authentication

Use multi-factor authentication wherever possible.

### M0808 Encrypt Network Traffic

Ensure that wired and/or wireless traffic is encrypted when feasible. Use best practices for authentication protocols, such as Kerberos, and ensure web traffic that may contain credentials is protected by SSL/TLS.

### M0814 Static Network Configuration

Statically defined ARP entries can prevent manipulation and sniffing of switched network traffic, as some AiTM techniques depend on sending spoofed ARP messages to manipulate network host's dynamic ARP tables.

## Detection

### Detection of Network Sniffing

## Risk Assessment

| Finding                               | Severity | Impact    |
| ------------------------------------- | -------- | --------- |
| Network Sniffing technique applicable | High     | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Enterprise ATT&CK January 2018](https://attack.mitre.org/wiki/Technique/T1040)
- [MITRE ATT&CK ICS - T0842](https://attack.mitre.org/techniques/T0842)
