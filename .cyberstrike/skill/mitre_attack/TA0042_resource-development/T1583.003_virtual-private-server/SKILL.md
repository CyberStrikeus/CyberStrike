---
name: "T1583.003_virtual-private-server"
description: "Adversaries may rent Virtual Private Servers (VPSs) that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1583.003
  - resource-development
  - pre
  - sub-technique
technique_id: "T1583.003"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1583/003"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1583
  - T1583.001
  - T1583.002
  - T1583.004
  - T1583.005
  - T1583.006
  - T1583.007
  - T1583.008
prerequisites:
  - T1583
severity_boost:
  T1583: "Chain with T1583 for deeper attack path"
  T1583.001: "Chain with T1583.001 for deeper attack path"
  T1583.002: "Chain with T1583.002 for deeper attack path"
---

# T1583.003 Virtual Private Server

> **Sub-technique of:** T1583

## High-Level Description

Adversaries may rent Virtual Private Servers (VPSs) that can be used during targeting. There exist a variety of cloud service providers that will sell virtual machines/containers as a service. By utilizing a VPS, adversaries can make it difficult to physically tie back operations to them. The use of cloud infrastructure can also make it easier for adversaries to rapidly provision, modify, and shut down their infrastructure.

Acquiring a VPS for use in later stages of the adversary lifecycle, such as Command and Control, can allow adversaries to benefit from the ubiquity and trust associated with higher reputation cloud service providers. Adversaries may also acquire infrastructure from VPS service providers that are known for renting VPSs with minimal registration information, allowing for more anonymous acquisitions of infrastructure.

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

2. **Assess Existing Defenses**: Review whether mitigations for T1583.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

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
- [TrendmicroHideoutsLease](https://documents.trendmicro.com/assets/wp/wp-criminal-hideouts-for-lease.pdf)
- [Mandiant SCANdalous Jul 2020](https://cloud.google.com/blog/topics/threat-intelligence/scandalous-external-detection-using-network-scan-data-and-automation/)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [Atomic Red Team - T1583.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1583.003)
- [MITRE ATT&CK - T1583.003](https://attack.mitre.org/techniques/T1583/003)
