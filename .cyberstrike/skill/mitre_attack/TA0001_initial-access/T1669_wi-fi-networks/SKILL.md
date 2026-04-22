---
name: "T1669_wi-fi-networks"
description: "Adversaries may gain initial access to target systems by connecting to wireless networks."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1669
  - initial-access
  - linux
  - network-devices
  - windows
  - macos
technique_id: "T1669"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Linux
  - Network Devices
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1669"
tech_stack:
  - linux
  - network devices
  - windows
  - macos
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1669 Wi-Fi Networks

## High-Level Description

Adversaries may gain initial access to target systems by connecting to wireless networks. They may accomplish this by exploiting open Wi-Fi networks used by target devices or by accessing secured Wi-Fi networks — requiring Valid Accounts — belonging to a target organization. Establishing a connection to a Wi-Fi access point requires a certain level of proximity to both discover and maintain a stable network connection.

Adversaries may establish a wireless connection through various methods, such as by physically positioning themselves near a Wi-Fi network to conduct close access operations. To bypass the need for physical proximity, adversaries may attempt to remotely compromise nearby third-party systems that have both wired and wireless network connections available (i.e., dual-homed systems). These third-party compromised devices can then serve as a bridge to connect to a target’s Wi-Fi network.

Once an initial wireless connection is achieved, adversaries may leverage this access for follow-on activities in the victim network or further targeting of specific devices on the network. Adversaries may perform Network Sniffing or Adversary-in-the-Middle activities for Credential Access or Discovery.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Linux, Network Devices, Windows, macOS

## What to Check

- [ ] Identify if Wi-Fi Networks technique is applicable to target environment
- [ ] Check Linux systems for indicators of Wi-Fi Networks
- [ ] Check Network Devices systems for indicators of Wi-Fi Networks
- [ ] Check Windows systems for indicators of Wi-Fi Networks
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Wi-Fi Networks by examining the target platforms (Linux, Network Devices, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1669 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication

Harden access requirements for Wi-Fi networks through using two or more pieces of evidence to authenticate, such as a username and password in addition to a token from a physical smart card or token generator.

### M1030 Network Segmentation

Network segmentation can be used to isolate infrastructure components that do not require broad network access. Separate networking environments for Wi-Fi and Ethernet-wired networks, particularly where Ethernet-based networks allow for access to sensitive resources.

### M1041 Encrypt Sensitive Information

Ensure that all wired and/or wireless traffic is encrypted appropriately. Use best practices for authentication protocols, such as Kerberos, and ensure that web traffic that may contain credentials is protected by SSL/TLS.

## Detection

### Detection Strategy for Wi-Fi Networks

## Risk Assessment

| Finding                             | Severity | Impact         |
| ----------------------------------- | -------- | -------------- |
| Wi-Fi Networks technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [Nearest Neighbor Volexity](https://www.volexity.com/blog/2024/11/22/the-nearest-neighbor-attack-how-a-russian-apt-weaponized-nearby-wi-fi-networks-for-covert-access/)
- [DOJ GRU Charges 2018](https://www.justice.gov/archives/opa/pr/us-charges-russian-gru-officers-international-hacking-and-related-influence-and)
- [Atomic Red Team - T1669](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1669)
- [MITRE ATT&CK - T1669](https://attack.mitre.org/techniques/T1669)
