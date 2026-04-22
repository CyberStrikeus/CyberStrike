---
name: "T1601.002_downgrade-system-image"
description: "Adversaries may install an older version of the operating system of a network device to weaken security."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1601.002
  - defense-evasion
  - network-devices
  - sub-technique
technique_id: "T1601.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1601/002"
tech_stack:
  - network devices
cwe_ids:
  - CWE-693
chains_with:
  - T1601
  - T1601.001
prerequisites:
  - T1601
severity_boost:
  T1601: "Chain with T1601 for deeper attack path"
  T1601.001: "Chain with T1601.001 for deeper attack path"
---

# T1601.002 Downgrade System Image

> **Sub-technique of:** T1601

## High-Level Description

Adversaries may install an older version of the operating system of a network device to weaken security. Older operating system versions on network devices often have weaker encryption ciphers and, in general, fewer/less updated defensive features. 

On embedded devices, downgrading the version typically only requires replacing the operating system file in storage. With most embedded devices, this can be achieved by downloading a copy of the desired version of the operating system file and reconfiguring the device to boot from that file on next system restart. The adversary could then restart the device to implement the change immediately or they could wait until the next time the system restarts.

Downgrading the system image to an older versions may allow an adversary to evade defenses by enabling behaviors such as Weaken Encryption. Downgrading of a system image can be done on its own, or it can be used in conjunction with Patch System Image.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Downgrade System Image technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Downgrade System Image
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Downgrade System Image by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1601.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1032 Multi-factor Authentication
Use multi-factor authentication for user and privileged accounts. Most embedded network devices support TACACS+ and/or RADIUS. Follow vendor prescribed best practices for hardening access control.

### M1045 Code Signing
Many vendors provide digitally signed operating system images to validate the integrity of the software used on their platform. Make use of this feature where possible in order to prevent and/or detect attempts by adversaries to compromise the system image.

### M1043 Credential Access Protection
Some embedded network devices are capable of storing passwords for local accounts in either plain-text or encrypted formats. Ensure that, where available, local passwords are always encrypted, per vendor recommendations.

### M1026 Privileged Account Management
Restrict administrator accounts to as few individuals as possible, following least privilege principles. Prevent credential overlap across systems of administrator and privileged accounts, particularly between network and non-network platforms, such as servers or endpoints.

### M1027 Password Policies
Refer to NIST guidelines when creating password policies.

### M1046 Boot Integrity
Some vendors of embedded network devices provide cryptographic signing to ensure the integrity of operating system images at boot time. Implement where available, following vendor guidelines.


## Detection

### Detection Strategy for Downgrade System Image on Network Devices


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Downgrade System Image technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Cisco Synful Knock Evolution](https://blogs.cisco.com/security/evolution-of-attacks-on-cisco-ios-devices)
- [Atomic Red Team - T1601.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1601.002)
- [MITRE ATT&CK - T1601.002](https://attack.mitre.org/techniques/T1601/002)
