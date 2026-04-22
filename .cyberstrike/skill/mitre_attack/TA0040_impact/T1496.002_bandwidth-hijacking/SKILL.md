---
name: "T1496.002_bandwidth-hijacking"
description: "Adversaries may leverage the network bandwidth resources of co-opted systems to complete resource-intensive tasks, which may impact system and/or hosted service availability."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1496.002
  - impact
  - linux
  - windows
  - macos
  - iaas
  - containers
  - sub-technique
technique_id: "T1496.002"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - Windows
  - macOS
  - IaaS
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1496/002"
tech_stack:
  - linux
  - windows
  - macos
  - cloud
  - containers
cwe_ids:
  - CWE-400
chains_with:
  - T1496
  - T1496.001
  - T1496.003
  - T1496.004
prerequisites:
  - T1496
severity_boost:
  T1496: "Chain with T1496 for deeper attack path"
  T1496.001: "Chain with T1496.001 for deeper attack path"
  T1496.003: "Chain with T1496.003 for deeper attack path"
---

# T1496.002 Bandwidth Hijacking

> **Sub-technique of:** T1496

## High-Level Description

Adversaries may leverage the network bandwidth resources of co-opted systems to complete resource-intensive tasks, which may impact system and/or hosted service availability. 

Adversaries may also use malware that leverages a system's network bandwidth as part of a botnet in order to facilitate Network Denial of Service campaigns and/or to seed malicious torrents. Alternatively, they may engage in proxyjacking by selling use of the victims' network bandwidth and IP address to proxyware services. Finally, they may engage in internet-wide scanning in order to identify additional targets for compromise.

In addition to incurring potential financial costs or availability disruptions, this technique may cause reputational damage if a victim’s bandwidth is used for illegal activities.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, Windows, macOS, IaaS, Containers

## What to Check

- [ ] Identify if Bandwidth Hijacking technique is applicable to target environment
- [ ] Check Linux systems for indicators of Bandwidth Hijacking
- [ ] Check Windows systems for indicators of Bandwidth Hijacking
- [ ] Check macOS systems for indicators of Bandwidth Hijacking
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Bandwidth Hijacking by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1496.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Excessive or Unauthorized Bandwidth Usage for Botnet, Proxyjacking, or Scanning Purposes


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Bandwidth Hijacking technique applicable | High | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Sysdig Proxyjacking](https://sysdig.com/blog/proxyjacking-attackers-log4j-exploited/)
- [Unit 42 Leaked Environment Variables 2024](https://unit42.paloaltonetworks.com/large-scale-cloud-extortion-operation/)
- [GoBotKR](https://www.welivesecurity.com/2019/07/08/south-korean-users-backdoor-torrents/)
- [Atomic Red Team - T1496.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1496.002)
- [MITRE ATT&CK - T1496.002](https://attack.mitre.org/techniques/T1496/002)
