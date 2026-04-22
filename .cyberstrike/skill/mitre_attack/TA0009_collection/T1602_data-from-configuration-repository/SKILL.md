---
name: "T1602_data-from-configuration-repository"
description: "Adversaries may collect data related to managed devices from configuration repositories."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1602
  - collection
  - network-devices
technique_id: "T1602"
tactic: "collection"
all_tactics:
  - collection
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1602"
tech_stack:
  - network devices
cwe_ids:
  - CWE-200
chains_with:
  - T1602.001
  - T1602.002
prerequisites:
  []
severity_boost:
  T1602.001: "Chain with T1602.001 for deeper attack path"
  T1602.002: "Chain with T1602.002 for deeper attack path"
---

# T1602 Data from Configuration Repository

## High-Level Description

Adversaries may collect data related to managed devices from configuration repositories. Configuration repositories are used by management systems in order to configure, manage, and control data on remote systems. Configuration repositories may also facilitate remote access and administration of devices.

Adversaries may target these repositories in order to collect large quantities of sensitive system administration data. Data from configuration repositories may be exposed by various protocols and software and can store a wide variety of data, much of which may align with adversary Discovery objectives.

## Kill Chain Phase

- Collection (TA0009)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Data from Configuration Repository technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Data from Configuration Repository
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Data from Configuration Repository by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1602 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1051 Update Software
Keep system images and software updated and migrate to SNMPv3.

### M1054 Software Configuration
Allowlist MIB objects and implement SNMP views.

### M1030 Network Segmentation
Segregate SNMP traffic on a separate management network.

### M1037 Filter Network Traffic
Apply extended ACLs to block unauthorized protocols outside the trusted network.

### M1031 Network Intrusion Prevention
Configure intrusion prevention devices to detect SNMP queries and commands from unauthorized sources.

### M1041 Encrypt Sensitive Information
Configure SNMPv3 to use the highest level of security (authPriv) available.


## Detection

### Detection Strategy for Data from Configuration Repository on Network Devices


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Data from Configuration Repository technique applicable | Medium | Collection |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-200 | Exposure of Sensitive Information |


## References

- [Cisco Advisory SNMP v3 Authentication Vulnerabilities](https://tools.cisco.com/security/center/content/CiscoAppliedMitigationBulletin/cisco-amb-20080610-SNMPv3)
- [US-CERT TA17-156A SNMP Abuse 2017](https://us-cert.cisa.gov/ncas/alerts/TA17-156A)
- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Atomic Red Team - T1602](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1602)
- [MITRE ATT&CK - T1602](https://attack.mitre.org/techniques/T1602)
