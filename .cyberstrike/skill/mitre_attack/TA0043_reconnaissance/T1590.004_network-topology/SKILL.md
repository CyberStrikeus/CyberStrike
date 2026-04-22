---
name: "T1590.004_network-topology"
description: "Adversaries may gather information about the victim's network topology that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1590.004
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1590.004"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1590/004"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1590
  - T1590.001
  - T1590.002
  - T1590.003
  - T1590.005
  - T1590.006
prerequisites:
  - T1590
severity_boost:
  T1590: "Chain with T1590 for deeper attack path"
  T1590.001: "Chain with T1590.001 for deeper attack path"
  T1590.002: "Chain with T1590.002 for deeper attack path"
---

# T1590.004 Network Topology

> **Sub-technique of:** T1590

## High-Level Description

Adversaries may gather information about the victim's network topology that can be used during targeting. Information about network topologies may include a variety of details, including the physical and/or logical arrangement of both external-facing and internal network environments. This information may also include specifics regarding network devices (gateways, routers, etc.) and other infrastructure.

Adversaries may gather this information in various ways, such as direct collection actions via Active Scanning or Phishing for Information. Information about network topologies may also be exposed to adversaries via online or other accessible data sets (ex: Search Victim-Owned Websites). Gathering this information may reveal opportunities for other forms of reconnaissance (ex: Search Open Technical Databases or Search Open Websites/Domains), establishing operational resources (ex: Acquire Infrastructure or Compromise Infrastructure), and/or initial access (ex: External Remote Services).

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Network Topology technique is applicable to target environment
- [ ] Check PRE systems for indicators of Network Topology
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Network Topology by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1590.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Network Topology

## Risk Assessment

| Finding                               | Severity | Impact         |
| ------------------------------------- | -------- | -------------- |
| Network Topology technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [DNS Dumpster](https://dnsdumpster.com/)
- [Atomic Red Team - T1590.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1590.004)
- [MITRE ATT&CK - T1590.004](https://attack.mitre.org/techniques/T1590/004)
