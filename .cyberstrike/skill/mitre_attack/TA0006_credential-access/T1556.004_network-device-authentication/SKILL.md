---
name: "T1556.004_network-device-authentication"
description: "Adversaries may use Patch System Image to hard code a password in the operating system, thus bypassing of native authentication mechanisms for local accounts on network devices."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.004
  - credential-access
  - defense-evasion
  - persistence
  - network-devices
  - sub-technique
technique_id: "T1556.004"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1556/004"
tech_stack:
  - network devices
cwe_ids:
  - CWE-522
chains_with:
  - T1556
  - T1556.001
  - T1556.002
  - T1556.003
  - T1556.005
  - T1556.006
  - T1556.007
  - T1556.008
  - T1556.009
prerequisites:
  - T1556
severity_boost:
  T1556: "Chain with T1556 for deeper attack path"
  T1556.001: "Chain with T1556.001 for deeper attack path"
  T1556.002: "Chain with T1556.002 for deeper attack path"
---

# T1556.004 Network Device Authentication

> **Sub-technique of:** T1556

## High-Level Description

Adversaries may use Patch System Image to hard code a password in the operating system, thus bypassing of native authentication mechanisms for local accounts on network devices.

Modify System Image may include implanted code to the operating system for network devices to provide access for adversaries using a specific password. The modification includes a specific password which is implanted in the operating system image via the patch. Upon authentication attempts, the inserted code will first check to see if the user input is the password. If so, access is granted. Otherwise, the implanted code will pass the credentials on for verification of potentially valid credentials.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if Network Device Authentication technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of Network Device Authentication
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Device Authentication by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Restrict administrator accounts to as few individuals as possible, following least privilege principles. Prevent credential overlap across systems of administrator and privileged accounts, particularly between network and non-network platforms, such as servers or endpoints.

### M1032 Multi-factor Authentication

Use multi-factor authentication for user and privileged accounts. Most embedded network devices support TACACS+ and/or RADIUS. Follow vendor prescribed best practices for hardening access control.

## Detection

### Detect Modification of Network Device Authentication via Patched System Images

## Risk Assessment

| Finding                                            | Severity | Impact            |
| -------------------------------------------------- | -------- | ----------------- |
| Network Device Authentication technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Mandiant - Synful Knock](https://cloud.google.com/blog/topics/threat-intelligence/synful-knock-acis/)
- [Cisco IOS Software Integrity Assurance - Image File Verification](https://tools.cisco.com/security/center/resources/integrity_assurance.html#7)
- [Cisco IOS Software Integrity Assurance - Run-Time Memory Verification](https://tools.cisco.com/security/center/resources/integrity_assurance.html#13)
- [Atomic Red Team - T1556.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.004)
- [MITRE ATT&CK - T1556.004](https://attack.mitre.org/techniques/T1556/004)
