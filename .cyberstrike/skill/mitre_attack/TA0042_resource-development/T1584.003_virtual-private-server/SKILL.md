---
name: "T1584.003_virtual-private-server"
description: "Adversaries may compromise third-party Virtual Private Servers (VPSs) that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1584.003
  - resource-development
  - pre
  - sub-technique
technique_id: "T1584.003"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1584/003"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1584
  - T1584.001
  - T1584.002
  - T1584.004
  - T1584.005
  - T1584.006
  - T1584.007
  - T1584.008
prerequisites:
  - T1584
severity_boost:
  T1584: "Chain with T1584 for deeper attack path"
  T1584.001: "Chain with T1584.001 for deeper attack path"
  T1584.002: "Chain with T1584.002 for deeper attack path"
---

# T1584.003 Virtual Private Server

> **Sub-technique of:** T1584

## High-Level Description

Adversaries may compromise third-party Virtual Private Servers (VPSs) that can be used during targeting. There exist a variety of cloud service providers that will sell virtual machines/containers as a service. Adversaries may compromise VPSs purchased by third-party entities. By compromising a VPS to use as infrastructure, adversaries can make it difficult to physically tie back operations to themselves.

Compromising a VPS for use in later stages of the adversary lifecycle, such as Command and Control, can allow adversaries to benefit from the ubiquity and trust associated with higher reputation cloud service providers as well as that added by the compromised third-party.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Virtual Private Server technique is applicable to target environment
- [ ] Check PRE systems for indicators of Virtual Private Server
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Virtual Private Server by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1584.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Virtual Private Server


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Virtual Private Server technique applicable | Low | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Koczwara Beacon Hunting Sep 2021](https://michaelkoczwara.medium.com/cobalt-strike-c2-hunting-with-shodan-c448d501a6e2)
- [NSA NCSC Turla OilRig](https://media.defense.gov/2019/Oct/18/2002197242/-1/-1/0/NSA_CSA_Turla_20191021%20ver%204%20-%20nsa.gov.pdf)
- [Mandiant SCANdalous Jul 2020](https://cloud.google.com/blog/topics/threat-intelligence/scandalous-external-detection-using-network-scan-data-and-automation/)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [Atomic Red Team - T1584.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1584.003)
- [MITRE ATT&CK - T1584.003](https://attack.mitre.org/techniques/T1584/003)
