---
name: "T1496.001_compute-hijacking"
description: "Adversaries may leverage the compute resources of co-opted systems to complete resource-intensive tasks, which may impact system and/or hosted service availability."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1496.001
  - impact
  - windows
  - iaas
  - linux
  - macos
  - containers
  - sub-technique
technique_id: "T1496.001"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1496/001"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
  - containers
cwe_ids:
  - CWE-400
chains_with:
  - T1496
  - T1496.002
  - T1496.003
  - T1496.004
prerequisites:
  - T1496
severity_boost:
  T1496: "Chain with T1496 for deeper attack path"
  T1496.002: "Chain with T1496.002 for deeper attack path"
  T1496.003: "Chain with T1496.003 for deeper attack path"
---

# T1496.001 Compute Hijacking

> **Sub-technique of:** T1496

## High-Level Description

Adversaries may leverage the compute resources of co-opted systems to complete resource-intensive tasks, which may impact system and/or hosted service availability.

One common purpose for Compute Hijacking is to validate transactions of cryptocurrency networks and earn virtual currency. Adversaries may consume enough system resources to negatively impact and/or cause affected machines to become unresponsive. Servers and cloud-based systems are common targets because of the high potential for available resources, but user endpoint systems may also be compromised and used for Compute Hijacking and cryptocurrency mining. Containerized environments may also be targeted due to the ease of deployment via exposed APIs and the potential for scaling mining activities by deploying or compromising multiple containers within an environment or cluster.

Additionally, some cryptocurrency mining malware identify then kill off processes for competing malware to ensure it’s not competing for resources.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Windows, IaaS, Linux, macOS, Containers

## What to Check

- [ ] Identify if Compute Hijacking technique is applicable to target environment
- [ ] Check Windows systems for indicators of Compute Hijacking
- [ ] Check IaaS systems for indicators of Compute Hijacking
- [ ] Check Linux systems for indicators of Compute Hijacking
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Compute Hijacking by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1496.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Multi-Platform Behavioral Detection for Compute Hijacking

## Risk Assessment

| Finding                                | Severity | Impact |
| -------------------------------------- | -------- | ------ |
| Compute Hijacking technique applicable | High     | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Unit 42 Hildegard Malware](https://unit42.paloaltonetworks.com/hildegard-malware-teamtnt/)
- [CloudSploit - Unused AWS Regions](https://medium.com/cloudsploit/the-danger-of-unused-aws-regions-af0bf1b878fc)
- [Kaspersky Lazarus Under The Hood Blog 2017](https://securelist.com/lazarus-under-the-hood/77908/)
- [Trend Micro Exposed Docker APIs](https://www.trendmicro.com/en_us/research/19/e/infected-cryptocurrency-mining-containers-target-docker-hosts-with-exposed-apis-use-shodan-to-find-additional-victims.html)
- [Trend Micro War of Crypto Miners](https://www.trendmicro.com/en_us/research/20/i/war-of-linux-cryptocurrency-miners-a-battle-for-resources.html)
- [Atomic Red Team - T1496.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1496.001)
- [MITRE ATT&CK - T1496.001](https://attack.mitre.org/techniques/T1496/001)
