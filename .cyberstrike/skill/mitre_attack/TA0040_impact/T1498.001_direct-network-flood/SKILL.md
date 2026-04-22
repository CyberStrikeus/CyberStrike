---
name: "T1498.001_direct-network-flood"
description: "Adversaries may attempt to cause a denial of service (DoS) by directly sending a high-volume of network traffic to a target."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1498.001
  - impact
  - windows
  - iaas
  - linux
  - macos
  - sub-technique
technique_id: "T1498.001"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1498/001"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
cwe_ids:
  - CWE-400
chains_with:
  - T1498
  - T1498.002
prerequisites:
  - T1498
severity_boost:
  T1498: "Chain with T1498 for deeper attack path"
  T1498.002: "Chain with T1498.002 for deeper attack path"
---

# T1498.001 Direct Network Flood

> **Sub-technique of:** T1498

## High-Level Description

Adversaries may attempt to cause a denial of service (DoS) by directly sending a high-volume of network traffic to a target. This DoS attack may also reduce the availability and functionality of the targeted system(s) and network. Direct Network Floods are when one or more systems are used to send a high-volume of network packets towards the targeted service's network. Almost any network protocol may be used for flooding. Stateless protocols such as UDP or ICMP are commonly used but stateful protocols such as TCP can be used as well.

Botnets are commonly used to conduct network flooding attacks against networks and services. Large botnets can generate a significant amount of traffic from systems spread across the global Internet. Adversaries may have the resources to build out and control their own botnet infrastructure or may rent time on an existing botnet to conduct an attack. In some of the worst cases for distributed DoS (DDoS), so many systems are used to generate the flood that each one only needs to send out a small amount of traffic to produce enough volume to saturate the target network. In such circumstances, distinguishing DDoS traffic from legitimate clients becomes exceedingly difficult. Botnets have been used in some of the most high-profile DDoS flooding attacks, such as the 2012 series of incidents that targeted major US banks.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Windows, IaaS, Linux, macOS

## What to Check

- [ ] Identify if Direct Network Flood technique is applicable to target environment
- [ ] Check Windows systems for indicators of Direct Network Flood
- [ ] Check IaaS systems for indicators of Direct Network Flood
- [ ] Check Linux systems for indicators of Direct Network Flood
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Direct Network Flood by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1498.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

When flood volumes exceed the capacity of the network connection being targeted, it is typically necessary to intercept the incoming traffic upstream to filter out the attack traffic from the legitimate traffic. Such defenses can be provided by the hosting Internet Service Provider (ISP) or by a 3rd party such as a Content Delivery Network (CDN) or providers specializing in DoS mitigations.

Depending on flood volume, on-premises filtering may be possible by blocking source addresses sourcing the attack, blocking ports that are being targeted, or blocking protocols being used for transport.

As immediate response may require rapid engagement of 3rd parties, analyze the risk associated to critical resources being affected by Network DoS attacks and create a disaster recovery plan/business continuity plan to respond to incidents.

## Detection

### Direct Network Flood Detection across IaaS, Linux, Windows, and macOS

## Risk Assessment

| Finding                                   | Severity | Impact |
| ----------------------------------------- | -------- | ------ |
| Direct Network Flood technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Cisco DoSdetectNetflow](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/netflow/configuration/15-mt/nf-15-mt-book/nf-detct-analy-thrts.pdf)
- [USNYAG IranianBotnet March 2016](https://www.justice.gov/opa/pr/seven-iranians-working-islamic-revolutionary-guard-corps-affiliated-entities-charged)
- [Atomic Red Team - T1498.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1498.001)
- [MITRE ATT&CK - T1498.001](https://attack.mitre.org/techniques/T1498/001)
