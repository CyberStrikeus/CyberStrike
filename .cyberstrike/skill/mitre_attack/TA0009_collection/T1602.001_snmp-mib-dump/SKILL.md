---
name: "T1602.001_snmp-mib-dump"
description: "Adversaries may target the Management Information Base (MIB) to collect and/or mine valuable information in a network managed using Simple Network Management Protocol (SNMP)."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1602.001
  - collection
  - network-devices
  - sub-technique
technique_id: "T1602.001"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1602/001"
tech_stack:
  - network devices
cwe_ids:
  - CWE-200
chains_with:
  - T1602
  - T1602.002
prerequisites:
  - T1602
severity_boost:
  T1602: "Chain with T1602 for deeper attack path"
  T1602.002: "Chain with T1602.002 for deeper attack path"
---

# T1602.001 SNMP (MIB Dump)

> **Sub-technique of:** T1602

## High-Level Description

Adversaries may target the Management Information Base (MIB) to collect and/or mine valuable information in a network managed using Simple Network Management Protocol (SNMP).

The MIB is a configuration repository that stores variable information accessible via SNMP in the form of object identifiers (OID). Each OID identifies a variable that can be read or set and permits active management tasks, such as configuration changes, through remote modification of these variables. SNMP can give administrators great insight in their systems, such as, system information, description of hardware, physical location, and software packages. The MIB may also contain device operational information, including running configuration, routing table, and interface details.

Adversaries may use SNMP queries to collect MIB content directly from SNMP-managed devices in order to collect network information that allows the adversary to build network maps and facilitate future targeted exploitation.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if SNMP (MIB Dump) technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of SNMP (MIB Dump)
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to SNMP (MIB Dump) by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1602.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1054 Software Configuration

Allowlist MIB objects and implement SNMP views.

### M1051 Update Software

Keep system images and software updated and migrate to SNMPv3.

### M1041 Encrypt Sensitive Information

Configure SNMPv3 to use the highest level of security (authPriv) available.

### M1031 Network Intrusion Prevention

Configure intrusion prevention devices to detect SNMP queries and commands from unauthorized sources.

### M1030 Network Segmentation

Segregate SNMP traffic on a separate management network.

### M1037 Filter Network Traffic

Apply extended ACLs to block unauthorized protocols outside the trusted network.

## Detection

### Detection Strategy for SNMP (MIB Dump) on Network Devices

## Risk Assessment

| Finding                              | Severity | Impact     |
| ------------------------------------ | -------- | ---------- |
| SNMP (MIB Dump) technique applicable | High     | Collection |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [SANS Information Security Reading Room Securing SNMP Securing SNMP](https://www.sans.org/reading-room/whitepapers/networkdevs/securing-snmp-net-snmp-snmpv3-1051)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Cisco Blog Legacy Device Attacks](https://community.cisco.com/t5/security-blogs/attackers-continue-to-target-legacy-devices/ba-p/4169954)
- [Cisco Advisory SNMP v3 Authentication Vulnerabilities](https://tools.cisco.com/security/center/content/CiscoAppliedMitigationBulletin/cisco-amb-20080610-SNMPv3)
- [Atomic Red Team - T1602.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1602.001)
- [MITRE ATT&CK - T1602.001](https://attack.mitre.org/techniques/T1602/001)
