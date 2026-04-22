---
name: "T1673_virtual-machine-discovery"
description: "An adversary may attempt to enumerate running virtual machines (VMs) after gaining access to a host or hypervisor."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1673
  - discovery
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1673"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1673"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1673 Virtual Machine Discovery

## High-Level Description

An adversary may attempt to enumerate running virtual machines (VMs) after gaining access to a host or hypervisor. For example, adversaries may enumerate a list of VMs on an ESXi hypervisor using a Hypervisor CLI such as `esxcli` or `vim-cmd` (e.g. `esxcli vm process list or vim-cmd vmsvc/getallvms`). Adversaries may also directly leverage a graphical user interface, such as VMware vCenter, in order to view virtual machines on a host.

Adversaries may use the information from Virtual Machine Discovery during discovery to shape follow-on behaviors. Subsequently discovered VMs may be leveraged for follow-on activities such as Service Stop or Data Encrypted for Impact.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Virtual Machine Discovery technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Virtual Machine Discovery
- [ ] Check Linux systems for indicators of Virtual Machine Discovery
- [ ] Check macOS systems for indicators of Virtual Machine Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Virtual Machine Discovery by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1673 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Virtual Machine Discovery

## Risk Assessment

| Finding                                        | Severity | Impact    |
| ---------------------------------------------- | -------- | --------- |
| Virtual Machine Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [TrendMicro Play](https://www.trendmicro.com/en_us/research/24/g/new-play-ransomware-linux-variant-targets-esxi-shows-ties-with-p.html)
- [Crowdstrike Hypervisor Jackpotting Pt 2 2021](https://www.crowdstrike.com/en-us/blog/hypervisor-jackpotting-ecrime-actors-increase-targeting-of-esxi-servers/)
- [Atomic Red Team - T1673](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1673)
- [MITRE ATT&CK - T1673](https://attack.mitre.org/techniques/T1673)
