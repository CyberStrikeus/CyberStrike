---
name: "T1584.005_botnet"
description: "Adversaries may compromise numerous third-party systems to form a botnet that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1584.005
  - resource-development
  - pre
  - sub-technique
technique_id: "T1584.005"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1584/005"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1584
  - T1584.001
  - T1584.002
  - T1584.003
  - T1584.004
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

# T1584.005 Botnet

> **Sub-technique of:** T1584

## High-Level Description

Adversaries may compromise numerous third-party systems to form a botnet that can be used during targeting. A botnet is a network of compromised systems that can be instructed to perform coordinated tasks. Instead of purchasing/renting a botnet from a booter/stresser service, adversaries may build their own botnet by compromising numerous third-party systems. Adversaries may also conduct a takeover of an existing botnet, such as redirecting bots to adversary-controlled C2 servers. With a botnet at their disposal, adversaries may perform follow-on activity such as large-scale Phishing or Distributed Denial of Service (DDoS).

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Botnet technique is applicable to target environment
- [ ] Check PRE systems for indicators of Botnet
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Botnet by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1584.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Botnet

## Risk Assessment

| Finding                     | Severity | Impact               |
| --------------------------- | -------- | -------------------- |
| Botnet technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [Dell Dridex Oct 2015](https://www.secureworks.com/research/dridex-bugat-v5-botnet-takeover-operation)
- [Imperva DDoS for Hire](https://www.imperva.com/learn/ddos/booters-stressers-ddosers/)
- [Norton Botnet](https://us.norton.com/internetsecurity-malware-what-is-a-botnet.html)
- [Atomic Red Team - T1584.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1584.005)
- [MITRE ATT&CK - T1584.005](https://attack.mitre.org/techniques/T1584/005)
