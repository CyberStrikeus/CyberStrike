---
name: "T1557.002_arp-cache-poisoning"
description: "Adversaries may poison Address Resolution Protocol (ARP) caches to position themselves between the communication of two or more networked devices."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1557.002
  - credential-access
  - collection
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1557.002"
tactic: "credential-access"
all_tactics:
  - credential-access
  - collection
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1557/002"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-522
chains_with:
  - T1557
  - T1557.001
  - T1557.003
  - T1557.004
prerequisites:
  - T1557
severity_boost:
  T1557: "Chain with T1557 for deeper attack path"
  T1557.001: "Chain with T1557.001 for deeper attack path"
  T1557.003: "Chain with T1557.003 for deeper attack path"
---

# T1557.002 ARP Cache Poisoning

> **Sub-technique of:** T1557

## High-Level Description

Adversaries may poison Address Resolution Protocol (ARP) caches to position themselves between the communication of two or more networked devices. This activity may be used to enable follow-on behaviors such as Network Sniffing or Transmitted Data Manipulation.

The ARP protocol is used to resolve IPv4 addresses to link layer addresses, such as a media access control (MAC) address. Devices in a local network segment communicate with each other by using link layer addresses. If a networked device does not have the link layer address of a particular networked device, it may send out a broadcast ARP request to the local network to translate the IP address to a MAC address. The device with the associated IP address directly replies with its MAC address. The networked device that made the ARP request will then use as well as store that information in its ARP cache.

An adversary may passively wait for an ARP request to poison the ARP cache of the requesting device. The adversary may reply with their MAC address, thus deceiving the victim by making them believe that they are communicating with the intended networked device. For the adversary to poison the ARP cache, their reply must be faster than the one made by the legitimate IP address owner. Adversaries may also send a gratuitous ARP reply that maliciously announces the ownership of a particular IP address to all the devices in the local network segment.

The ARP protocol is stateless and does not require authentication. Therefore, devices may wrongly add or update the MAC address of the IP address in their ARP cache.

Adversaries may use ARP cache poisoning as a means to intercept network traffic. This activity may be used to collect and/or relay data such as credentials, especially those sent over an insecure, unencrypted protocol.

## Kill Chain Phase

- Credential Access (TA0006)
- Collection (TA0009)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if ARP Cache Poisoning technique is applicable to target environment
- [ ] Check Linux systems for indicators of ARP Cache Poisoning
- [ ] Check Windows systems for indicators of ARP Cache Poisoning
- [ ] Check macOS systems for indicators of ARP Cache Poisoning
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to ARP Cache Poisoning by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1557.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1041 Encrypt Sensitive Information

Ensure that all wired and/or wireless traffic is encrypted appropriately. Use best practices for authentication protocols, such as Kerberos, and ensure web traffic that may contain credentials is protected by SSL/TLS.

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that can identify traffic patterns indicative of AiTM activity can be used to mitigate activity at the network level.

### M1017 User Training

Train users to be suspicious about certificate errors. Adversaries may use their own certificates in an attempt to intercept HTTPS traffic. Certificate errors may arise when the application’s certificate does not match the one expected by the host.

### M1042 Disable or Remove Feature or Program

Consider disabling updating the ARP cache on gratuitous ARP replies.

### M1035 Limit Access to Resource Over Network

Create static ARP entries for networked devices. Implementing static ARP entries may be infeasible for large networks.

### M1037 Filter Network Traffic

Consider enabling DHCP Snooping and Dynamic ARP Inspection on switches to create mappings between IP addresses requested via DHCP and ARP tables and tie the values to a port on the switch that may block bogus traffic.

## Detection

### Detect ARP Cache Poisoning Across Linux, Windows, and macOS

## Risk Assessment

| Finding                                  | Severity | Impact            |
| ---------------------------------------- | -------- | ----------------- |
| ARP Cache Poisoning technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Cylance Cleaver](https://web.archive.org/web/20200302085133/https://www.cylance.com/content/dam/cylance/pages/operation-cleaver/Cylance_Operation_Cleaver_Report.pdf)
- [RFC826 ARP](https://tools.ietf.org/html/rfc826)
- [Sans ARP Spoofing Aug 2003](https://pen-testing.sans.org/resources/papers/gcih/real-world-arp-spoofing-105411)
- [Atomic Red Team - T1557.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1557.002)
- [MITRE ATT&CK - T1557.002](https://attack.mitre.org/techniques/T1557/002)
