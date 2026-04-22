---
name: "T1568.003_dns-calculation"
description: "Adversaries may perform calculations on addresses returned in DNS results to determine which port and IP address to use for command and control, rather than relying on a predetermined port number o..."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1568.003
  - command-and-control
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1568.003"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1568/003"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1568
  - T1568.001
  - T1568.002
prerequisites:
  - T1568
severity_boost:
  T1568: "Chain with T1568 for deeper attack path"
  T1568.001: "Chain with T1568.001 for deeper attack path"
  T1568.002: "Chain with T1568.002 for deeper attack path"
---

# T1568.003 DNS Calculation

> **Sub-technique of:** T1568

## High-Level Description

Adversaries may perform calculations on addresses returned in DNS results to determine which port and IP address to use for command and control, rather than relying on a predetermined port number or the actual returned IP address. A IP and/or port number calculation can be used to bypass egress filtering on a C2 channel.

One implementation of DNS Calculation is to take the first three octets of an IP address in a DNS response and use those values to calculate the port for command and control traffic.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if DNS Calculation technique is applicable to target environment
- [ ] Check Linux systems for indicators of DNS Calculation
- [ ] Check macOS systems for indicators of DNS Calculation
- [ ] Check Windows systems for indicators of DNS Calculation
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to DNS Calculation by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1568.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Dynamic Resolution through DNS Calculation

## Risk Assessment

| Finding                              | Severity | Impact              |
| ------------------------------------ | -------- | ------------------- |
| DNS Calculation technique applicable | Low      | Command And Control |

## CWE Categories

| CWE ID  | Title                              |
| ------- | ---------------------------------- |
| CWE-300 | Channel Accessible by Non-Endpoint |

## References

- [Meyers Numbered Panda](http://www.crowdstrike.com/blog/whois-numbered-panda/)
- [Moran 2014](https://www.fireeye.com/blog/threat-research/2014/09/darwins-favorite-apt-group-2.html)
- [Rapid7G20Espionage](https://blog.rapid7.com/2013/08/26/upcoming-g20-summit-fuels-espionage-operations/)
- [Atomic Red Team - T1568.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1568.003)
- [MITRE ATT&CK - T1568.003](https://attack.mitre.org/techniques/T1568/003)
