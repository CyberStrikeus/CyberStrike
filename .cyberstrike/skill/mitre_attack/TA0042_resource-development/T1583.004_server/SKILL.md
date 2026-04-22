---
name: "T1583.004_server"
description: "Adversaries may buy, lease, rent, or obtain physical servers that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1583.004
  - resource-development
  - pre
  - sub-technique
technique_id: "T1583.004"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1583/004"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1583
  - T1583.001
  - T1583.002
  - T1583.003
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

# T1583.004 Server

> **Sub-technique of:** T1583

## High-Level Description

Adversaries may buy, lease, rent, or obtain physical servers that can be used during targeting. Use of servers allows an adversary to stage, launch, and execute an operation. During post-compromise activity, adversaries may utilize servers for various tasks, such as watering hole operations in Drive-by Compromise, enabling Phishing operations, or facilitating Command and Control. Instead of compromising a third-party Server or renting a Virtual Private Server, adversaries may opt to configure and run their own servers in support of operations. Free trial periods of cloud servers may also be abused. 

Adversaries may only need a lightweight setup if most of their activities will take place using online infrastructure. Or, they may need to build extensive infrastructure if they want to test, communicate, and control other aspects of their activities on their own systems.

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

2. **Assess Existing Defenses**: Review whether mitigations for T1583.004 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Server


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Server technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Freejacked](https://sysdig.com/blog/googles-vertex-ai-platform-freejacked/)
- [Free Trial PurpleUrchin](https://unit42.paloaltonetworks.com/purpleurchin-steals-cloud-resources/)
- [Koczwara Beacon Hunting Sep 2021](https://michaelkoczwara.medium.com/cobalt-strike-c2-hunting-with-shodan-c448d501a6e2)
- [Mandiant SCANdalous Jul 2020](https://cloud.google.com/blog/topics/threat-intelligence/scandalous-external-detection-using-network-scan-data-and-automation/)
- [ThreatConnect Infrastructure Dec 2020](https://threatconnect.com/blog/infrastructure-research-hunting/)
- [NYTStuxnet](https://www.nytimes.com/2011/01/16/world/middleeast/16stuxnet.html)
- [Atomic Red Team - T1583.004](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1583.004)
- [MITRE ATT&CK - T1583.004](https://attack.mitre.org/techniques/T1583/004)
