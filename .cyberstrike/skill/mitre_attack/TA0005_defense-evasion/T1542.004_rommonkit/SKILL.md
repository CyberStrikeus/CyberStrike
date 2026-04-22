---
name: "T1542.004_rommonkit"
description: "Adversaries may abuse the ROM Monitor (ROMMON) by loading an unauthorized firmware with adversary code to provide persistent access and manipulate device behavior that is difficult to detect."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1542.004
  - defense-evasion
  - persistence
  - network-devices
  - sub-technique
technique_id: "T1542.004"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - persistence
platforms:
  - Network Devices
mitre_url: "https://attack.mitre.org/techniques/T1542/004"
tech_stack:
  - network devices
cwe_ids:
  - CWE-693
chains_with:
  - T1542
  - T1542.001
  - T1542.002
  - T1542.003
  - T1542.005
prerequisites:
  - T1542
severity_boost:
  T1542: "Chain with T1542 for deeper attack path"
  T1542.001: "Chain with T1542.001 for deeper attack path"
  T1542.002: "Chain with T1542.002 for deeper attack path"
---

# T1542.004 ROMMONkit

> **Sub-technique of:** T1542

## High-Level Description

Adversaries may abuse the ROM Monitor (ROMMON) by loading an unauthorized firmware with adversary code to provide persistent access and manipulate device behavior that is difficult to detect.

ROMMON is a Cisco network device firmware that functions as a boot loader, boot image, or boot helper to initialize hardware and software when the platform is powered on or reset. Similar to TFTP Boot, an adversary may upgrade the ROMMON image locally or remotely (for example, through TFTP) with adversary code and restart the device in order to overwrite the existing ROMMON image. This provides adversaries with the means to update the ROMMON to gain persistence on a system in a way that may be difficult to detect.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Network Devices

## What to Check

- [ ] Identify if ROMMONkit technique is applicable to target environment
- [ ] Check Network Devices systems for indicators of ROMMONkit
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to ROMMONkit by examining the target platforms (Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1542.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1046 Boot Integrity

Enable secure boot features to validate the digital signature of the boot environment and system image using a special purpose hardware device. If the validation check fails, the device will fail to boot preventing loading of unauthorized software.

### M1047 Audit

Periodically check the integrity of system image to ensure it has not been modified.

### M1031 Network Intrusion Prevention

Network intrusion detection and prevention systems that use network signatures to identify traffic for specific protocols, such as TFTP, can be used to mitigate activity at the network level. Signatures are often for unique indicators within protocols and may be based on the specific technique used by a particular adversary or tool, and will likely be different across various network configurations.

## Detection

### Detection Strategy for T1542.004 Pre-OS Boot: ROMMONkit

## Risk Assessment

| Finding                        | Severity | Impact          |
| ------------------------------ | -------- | --------------- |
| ROMMONkit technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Cisco Synful Knock Evolution](https://blogs.cisco.com/security/evolution-of-attacks-on-cisco-ios-devices)
- [Cisco Blog Legacy Device Attacks](https://community.cisco.com/t5/security-blogs/attackers-continue-to-target-legacy-devices/ba-p/4169954)
- [Atomic Red Team - T1542.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1542.004)
- [MITRE ATT&CK - T1542.004](https://attack.mitre.org/techniques/T1542/004)
