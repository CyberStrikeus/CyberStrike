---
name: "T1602.002_network-device-configuration-dump"
description: "Adversaries may access network configuration files to collect sensitive data about the device and the network."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1602.002
  - collection
  - network-devices
  - sub-technique
technique_id: "T1602.002"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1602/002"
tech_stack:
  - network devices
cwe_ids:
  - CWE-200
chains_with:
  - T1602
  - T1602.001
prerequisites:
  - T1602
severity_boost:
  T1602: "Chain with T1602 for deeper attack path"
  T1602.001: "Chain with T1602.001 for deeper attack path"
---

# T1602.002 Network Device Configuration Dump

> **Sub-technique of:** T1602

## High-Level Description

Adversaries may access network configuration files to collect sensitive data about the device and the network. The network configuration is a file containing parameters that determine the operation of the device. The device typically stores an in-memory copy of the configuration while operating, and a separate configuration on non-volatile storage to load after device reset. Adversaries can inspect the configuration files to reveal information about the target network and its layout, the network device and its software, or identifying legitimate accounts and credentials for later use.

Adversaries can use common management tools and protocols, such as Simple Network Management Protocol (SNMP) and Smart Install (SMI), to access network configuration files. These tools may be used to query specific data from a configuration repository or configure the device to export the configuration for later analysis.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Network Device Configuration Dump technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Network Device Configuration Dump
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Device Configuration Dump by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1602.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1041 Encrypt Sensitive Information
Configure SNMPv3 to use the highest level of security (authPriv) available.

### M1030 Network Segmentation
Segregate SNMP traffic on a separate management network.

### M1031 Network Intrusion Prevention
Configure intrusion prevention devices to detect SNMP queries and commands from unauthorized sources. Create signatures to detect Smart Install (SMI) usage from sources other than trusted director.

### M1054 Software Configuration
Allowlist MIB objects and implement SNMP views. Disable Smart Install (SMI) if not used.

### M1037 Filter Network Traffic
Apply extended ACLs to block unauthorized protocols outside the trusted network.

### M1051 Update Software
Keep system images and software updated and migrate to SNMPv3.


## Detection

### Detection Strategy for Network Device Configuration Dump via Config Repositories


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Network Device Configuration Dump technique applicable | High | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [US-CERT TA18-106A Network Infrastructure Devices 2018](https://us-cert.cisa.gov/ncas/alerts/TA18-106A)
- [Cisco Blog Legacy Device Attacks](https://community.cisco.com/t5/security-blogs/attackers-continue-to-target-legacy-devices/ba-p/4169954)
- [US-CERT TA18-068A 2018](https://www.us-cert.gov/ncas/alerts/TA18-086A)
- [Atomic Red Team - T1602.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1602.002)
- [MITRE ATT&CK - T1602.002](https://attack.mitre.org/techniques/T1602/002)
