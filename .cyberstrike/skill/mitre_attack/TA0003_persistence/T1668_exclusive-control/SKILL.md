---
name: "T1668_exclusive-control"
description: "Adversaries who successfully compromise a system may attempt to maintain persistence by “closing the door” behind them – in other words, by preventing other threat actors from initially accessing o..."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1668
  - persistence
  - linux
  - macos
  - windows
technique_id: "T1668"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1668"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-276
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1668 Exclusive Control

## High-Level Description

Adversaries who successfully compromise a system may attempt to maintain persistence by “closing the door” behind them – in other words, by preventing other threat actors from initially accessing or maintaining a foothold on the same system. 

For example, adversaries may patch a vulnerable, compromised system to prevent other threat actors from leveraging that vulnerability in the future. They may “close the door” in other ways, such as disabling vulnerable services, stripping privileges from accounts, or removing other malware already on the compromised device.

Hindering other threat actors may allow an adversary to maintain sole access to a compromised system or network. This prevents the threat actor from needing to compete with or even being removed themselves by other threat actors. It also reduces the “noise” in the environment, lowering the possibility of being caught and evicted by defenders. Finally, in the case of Resource Hijacking, leveraging a compromised device’s full power allows the threat actor to maximize profit.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Exclusive Control technique is applicable to target environment
- [ ] Check Linux systems for indicators of Exclusive Control
- [ ] Check macOS systems for indicators of Exclusive Control
- [ ] Check Windows systems for indicators of Exclusive Control
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exclusive Control by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1668 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Exclusive Control


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Exclusive Control technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [aquasec-postgres-processes](https://www.aquasec.com/blog/pg_mem-a-malware-hidden-in-the-postgres-processes/)
- [CERT AT Fortinent Ransomware 2025](https://www.cert.at/de/warnungen/2025/3/ransomware-gruppen-nutzen-weiterhin-kritische-fortinet-schwachstellen-warnung-vor-gepatchten-aber-bereits-kompromittierten-geraten)
- [fsecure-netsky](https://www.f-secure.com/v-descs/netsky-h.shtml)
- [sophos-multiple-attackers](https://news.sophos.com/en-us/2022/08/09/multiple-attackers-increase-pressure-on-victims-complicate-incident-response/#:~:text=While%20some%20threat%20actors%20are%20interdependent%20%28e.g.%2C%20IABs,vulnerabilities%20or%20disabling%20vulnerable%20services%20after%20gaining%20access)
- [Mandiant-iab-control](https://cloud.google.com/blog/topics/threat-intelligence/initial-access-brokers-exploit-f5-screenconnect)
- [Atomic Red Team - T1668](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1668)
- [MITRE ATT&CK - T1668](https://attack.mitre.org/techniques/T1668)
