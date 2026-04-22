---
name: "T1200_hardware-additions"
description: "Adversaries may physically introduce computer accessories, networking hardware, or other computing devices into a system or network that can be used as a vector to gain access."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1200
  - initial-access
  - windows
  - linux
  - macos
technique_id: "T1200"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - Windows
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1200"
tech_stack:
  - windows
  - linux
  - macos
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1200 Hardware Additions

## High-Level Description

Adversaries may physically introduce computer accessories, networking hardware, or other computing devices into a system or network that can be used as a vector to gain access. Rather than just connecting and distributing payloads via removable storage (i.e. Replication Through Removable Media), more robust hardware additions can be used to introduce new functionalities and/or features into a system that can then be abused.

While public references of usage by threat actors are scarce, many red teams/penetration testers leverage hardware additions for initial access. Commercial and open source products can be leveraged with capabilities such as passive network tapping, network traffic modification (i.e. Adversary-in-the-Middle), keystroke injection, kernel memory reading via DMA, addition of new wireless access points to an existing network, and others.

## Kill Chain Phase

- Initial Access (TA0001)

**Platforms:** Windows, Linux, macOS

## What to Check

- [ ] Identify if Hardware Additions technique is applicable to target environment
- [ ] Check Windows systems for indicators of Hardware Additions
- [ ] Check Linux systems for indicators of Hardware Additions
- [ ] Check macOS systems for indicators of Hardware Additions
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hardware Additions by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1200 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1035 Limit Access to Resource Over Network
Establish network access control policies, such as using device certificates and the 802.1x standard. Restrict use of DHCP to registered devices to prevent unregistered devices from communicating with trusted systems.

### M1034 Limit Hardware Installation
Block unknown devices and accessories by endpoint security configuration and monitoring agent.


## Detection

### Detect unauthorized or suspicious Hardware Additions (USB/Thunderbolt/Network)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Hardware Additions technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [Ossmann Star Feb 2011](https://ossmann.blogspot.com/2011/02/throwing-star-lan-tap.html)
- [Aleks Weapons Nov 2015](https://www.youtube.com/watch?v=lDvf4ScWbcQ)
- [McMillan Pwn March 2012](https://arstechnica.com/information-technology/2012/03/the-pwn-plug-is-a-little-white-box-that-can-hack-your-network/)
- [Frisk DMA August 2016](https://www.youtube.com/watch?v=fXthwl6ShOg)
- [Atomic Red Team - T1200](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1200)
- [MITRE ATT&CK - T1200](https://attack.mitre.org/techniques/T1200)
