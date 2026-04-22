---
name: "T1584.004_server"
description: "Adversaries may compromise third-party servers that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1584.004
  - resource-development
  - pre
  - sub-technique
technique_id: "T1584.004"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1584/004"
tech_stack:
  - pre
cwe_ids: []
chains_with:
  - T1584
  - T1584.001
  - T1584.002
  - T1584.003
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

# T1584.004 Server

> **Sub-technique of:** T1584

## High-Level Description

Adversaries may compromise third-party servers that can be used during targeting. Use of servers allows an adversary to stage, launch, and execute an operation. During post-compromise activity, adversaries may utilize servers for various tasks, including for Command and Control. Instead of purchasing a Server or Virtual Private Server, adversaries may compromise third-party servers in support of operations.

Adversaries may also compromise web servers to support watering hole operations, as in Drive-by Compromise, or email servers to support Phishing operations.

## Kill Chain Phase

- Resource Development (TA0042)

**Platforms:** PRE

## What to Check

- [ ] Identify if Server technique is applicable to target environment
- [ ] Check PRE systems for indicators of Server
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Server by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1584.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.

## Detection

### Detection of Server

## Risk Assessment

| Finding                     | Severity | Impact               |
| --------------------------- | -------- | -------------------- |
| Server technique applicable | High     | Resource Development |

## CWE Categories

| CWE ID | Title                 |
| ------ | --------------------- |
| N/A    | No direct CWE mapping |

## References

- [TrendMicro EarthLusca 2022](https://www.trendmicro.com/content/dam/trendmicro/global/en/research/22/a/earth-lusca-employs-sophisticated-infrastructure-varied-tools-and-techniques/technical-brief-delving-deep-an-analysis-of-earth-lusca-operations.pdf)
- [Koczwara Beacon Hunting Sep 2021](https://michaelkoczwara.medium.com/cobalt-strike-c2-hunting-with-shodan-c448d501a6e2)
- [Mandiant SCANdalous Jul 2020](https://cloud.google.com/blog/topics/threat-intelligence/scandalous-external-detection-using-network-scan-data-and-automation/)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [Atomic Red Team - T1584.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1584.004)
- [MITRE ATT&CK - T1584.004](https://attack.mitre.org/techniques/T1584/004)
