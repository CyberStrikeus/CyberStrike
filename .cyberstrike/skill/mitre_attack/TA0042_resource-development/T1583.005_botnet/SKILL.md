---
name: "T1583.005_botnet"
description: "Adversaries may buy, lease, or rent a network of compromised systems that can be used during targeting."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1583.005
  - resource-development
  - pre
  - sub-technique
technique_id: "T1583.005"
tactic: "resource-development"
all_tactics:
  - resource-development
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1583/005"
tech_stack:
  - pre
cwe_ids:
  []
chains_with:
  - T1583
  - T1583.001
  - T1583.002
  - T1583.003
  - T1583.004
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

# T1583.005 Botnet

> **Sub-technique of:** T1583

## High-Level Description

Adversaries may buy, lease, or rent a network of compromised systems that can be used during targeting. A botnet is a network of compromised systems that can be instructed to perform coordinated tasks. Adversaries may purchase a subscription to use an existing botnet from a booter/stresser service. 

Internet-facing edge devices and related network appliances that are end-of-life (EOL) and unsupported by their manufacturers are commonly acquired for botnet activities. Adversaries may lease operational relay box (ORB) networks – consisting of virtual private servers (VPS), small office/home office (SOHO) routers, or Internet of Things (IoT) devices – to serve as a botnet. 

With a botnet at their disposal, adversaries may perform follow-on activity such as large-scale Phishing or Distributed Denial of Service (DDoS). Acquired botnets may also be used to support Command and Control activity, such as Hide Infrastructure through an established Proxy network.

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

2. **Assess Existing Defenses**: Review whether mitigations for T1583.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1056 Pre-compromise
This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls.


## Detection

### Detection of Botnet


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Botnet technique applicable | High | Resource Development |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| N/A | No direct CWE mapping |

## References

- [Krebs-Booter](https://krebsonsecurity.com/2016/10/are-the-days-of-booter-services-numbered/)
- [Krebs-Bazaar](https://krebsonsecurity.com/2016/10/hackforums-shutters-booter-service-bazaar/)
- [Krebs-Anna](https://krebsonsecurity.com/2017/01/who-is-anna-senpai-the-mirai-worm-author/)
- [Imperva DDoS for Hire](https://www.imperva.com/learn/ddos/booters-stressers-ddosers/)
- [Norton Botnet](https://us.norton.com/internetsecurity-malware-what-is-a-botnet.html)
- [ORB Mandiant](https://cloud.google.com/blog/topics/threat-intelligence/china-nexus-espionage-orb-networks)
- [Atomic Red Team - T1583.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1583.005)
- [MITRE ATT&CK - T1583.005](https://attack.mitre.org/techniques/T1583/005)
