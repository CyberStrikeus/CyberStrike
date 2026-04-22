---
name: "T1542.005_tftp-boot"
description: "Adversaries may abuse netbooting to load an unauthorized network device operating system from a Trivial File Transfer Protocol (TFTP) server."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1542.005
  - defense-evasion
  - persistence
  - network-devices
  - sub-technique
technique_id: "T1542.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1542/005"
tech_stack:
  - network devices
cwe_ids:
  - CWE-693
chains_with:
  - T1542
  - T1542.001
  - T1542.002
  - T1542.003
  - T1542.004
prerequisites:
  - T1542
severity_boost:
  T1542: "Chain with T1542 for deeper attack path"
  T1542.001: "Chain with T1542.001 for deeper attack path"
  T1542.002: "Chain with T1542.002 for deeper attack path"
---

# T1542.005 TFTP Boot

> **Sub-technique of:** T1542

## High-Level Description

Adversaries may abuse netbooting to load an unauthorized network device operating system from a Trivial File Transfer Protocol (TFTP) server. TFTP boot (netbooting) is commonly used by network administrators to load configuration-controlled network device images from a centralized management server. Netbooting is one option in the boot sequence and can be used to centralize, manage, and control device images.

Adversaries may manipulate the configuration on the network device specifying use of a malicious TFTP server, which may be used in conjunction with Modify System Image to load a modified image on device startup or reset. The unauthorized image allows adversaries to modify device configuration, add malicious capabilities to the device, and introduce backdoors to maintain control of the network device while minimizing detection through use of a standard functionality. This technique is similar to ROMMONkit and may result in the network device running a modified image.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if TFTP Boot technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of TFTP Boot
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to TFTP Boot by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1542.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention
Network intrusion detection and prevention systems that use network signatures to identify traffic for specific protocols, such as TFTP, can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific technique used by a particular adversary or tool, and will likely be different across various network configurations.

### M1028 Operating System Configuration
Follow vendor device hardening best practices to disable unnecessary and unused features and services, avoid using default configurations and passwords, and introduce logging and auditing for detection.

### M1026 Privileged Account Management
Use of Authentication, Authorization, and Accounting (AAA) systems will limit actions administrators can perform and provide a history of user actions to detect unauthorized use and abuse. TACACS+ can keep control over which commands administrators are permitted to use through the configuration of authentication and command authorization.

### M1035 Limit Access to Resource Over Network
Restrict use of protocols without encryption or authentication mechanisms. Limit access to administrative and management interfaces from untrusted network sources.

### M1047 Audit
Periodically check the integrity of the running configuration and system image to ensure they have not been modified.

### M1046 Boot Integrity
Enable secure boot features to validate the digital signature of the boot environment and system image using a special purpose hardware device. If the validation check fails, the device will fail to boot preventing loading of unauthorized software.


## Detection

### Detection Strategy for T1542.005 Pre-OS Boot: TFTP Boot


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| TFTP Boot technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Cisco Blog Legacy Device Attacks](https://community.cisco.com/t5/security-blogs/attackers-continue-to-target-legacy-devices/ba-p/4169954)
- [Cisco IOS Software Integrity Assurance - Secure Boot](https://tools.cisco.com/security/center/resources/integrity_assurance.html#35)
- [Cisco IOS Software Integrity Assurance - Image File Verification](https://tools.cisco.com/security/center/resources/integrity_assurance.html#7)
- [Cisco IOS Software Integrity Assurance - Run-Time Memory Verification](https://tools.cisco.com/security/center/resources/integrity_assurance.html#13)
- [Cisco IOS Software Integrity Assurance - Command History](https://tools.cisco.com/security/center/resources/integrity_assurance.html#23)
- [Cisco IOS Software Integrity Assurance - Boot Information](https://tools.cisco.com/security/center/resources/integrity_assurance.html#26)
- [Atomic Red Team - T1542.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1542.005)
- [MITRE ATT&CK - T1542.005](https://attack.mitre.org/techniques/T1542/005)
