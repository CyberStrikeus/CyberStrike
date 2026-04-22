---
name: "T1601_modify-system-image"
description: "Adversaries may make changes to the operating system of embedded network devices to weaken defenses and provide new capabilities for themselves."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1601
  - defense-evasion
  - network-devices
technique_id: "T1601"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1601"
tech_stack:
  - network devices
cwe_ids:
  - CWE-693
chains_with:
  - T1601.001
  - T1601.002
prerequisites:
  []
severity_boost:
  T1601.001: "Chain with T1601.001 for deeper attack path"
  T1601.002: "Chain with T1601.002 for deeper attack path"
---

# T1601 Modify System Image

## High-Level Description

Adversaries may make changes to the operating system of embedded network devices to weaken defenses and provide new capabilities for themselves. On such devices, the operating systems are typically monolithic and most of the device functionality and capabilities are contained within a single file.

To change the operating system, the adversary typically only needs to affect this one file, replacing or modifying it. This can either be done live in memory during system runtime for immediate effect, or in storage to implement the change on the next boot of the network device.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Modify System Image technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Modify System Image
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Modify System Image by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1601 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication
Use multi-factor authentication for user and privileged accounts. Most embedded network devices support TACACS+ and/or RADIUS. Follow vendor prescribed best practices for hardening access control.

### M1027 Password Policies
Refer to NIST guidelines when creating password policies.

### M1043 Credential Access Protection
Some embedded network devices are capable of storing passwords for local accounts in either plain-text or encrypted formats. Ensure that, where available, local passwords are always encrypted, per vendor recommendations.

### M1045 Code Signing
Many vendors provide digitally signed operating system images to validate the integrity of the software used on their platform. Make use of this feature where possible in order to prevent and/or detect attempts by adversaries to compromise the system image.

### M1046 Boot Integrity
Some vendors of embedded network devices provide cryptographic signing to ensure the integrity of operating system images at boot time. Implement where available, following vendor guidelines.

### M1026 Privileged Account Management
Restrict administrator accounts to as few individuals as possible, following least privilege principles. Prevent credential overlap across systems of administrator and privileged accounts, particularly between network and non-network platforms, such as servers or endpoints.


## Detection

### Detection Strategy for Modify System Image on Network Devices


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Modify System Image technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Cisco IOS Software Integrity Assurance - Image File Verification](https://tools.cisco.com/security/center/resources/integrity_assurance.html#7)
- [Cisco IOS Software Integrity Assurance - Run-Time Memory Verification](https://tools.cisco.com/security/center/resources/integrity_assurance.html#13)
- [Atomic Red Team - T1601](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1601)
- [MITRE ATT&CK - T1601](https://attack.mitre.org/techniques/T1601)
