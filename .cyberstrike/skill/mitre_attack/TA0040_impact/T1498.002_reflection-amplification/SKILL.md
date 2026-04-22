---
name: "T1498.002_reflection-amplification"
description: "Adversaries may attempt to cause a denial of service (DoS) by reflecting a high-volume of network traffic to a target."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1498.002
  - impact
  - windows
  - iaas
  - linux
  - macos
  - sub-technique
technique_id: "T1498.002"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1498/002"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
cwe_ids:
  - CWE-400
chains_with:
  - T1498
  - T1498.001
prerequisites:
  - T1498
severity_boost:
  T1498: "Chain with T1498 for deeper attack path"
  T1498.001: "Chain with T1498.001 for deeper attack path"
---

# T1498.002 Reflection Amplification

> **Sub-technique of:** T1498

## High-Level Description

Adversaries may attempt to cause a denial of service (DoS) by reflecting a high-volume of network traffic to a target. This type of Network DoS takes advantage of a third-party server intermediary that hosts and will respond to a given spoofed source IP address. This third-party server is commonly termed a reflector. An adversary accomplishes a reflection attack by sending packets to reflectors with the spoofed address of the victim. Similar to Direct Network Floods, more than one system may be used to conduct the attack, or a botnet may be used. Likewise, one or more reflectors may be used to focus traffic on the target. This Network DoS attack may also reduce the availability and functionality of the targeted system(s) and network.

Reflection attacks often take advantage of protocols with larger responses than requests in order to amplify their traffic, commonly known as a Reflection Amplification attack. Adversaries may be able to generate an increase in volume of attack traffic that is several orders of magnitude greater than the requests sent to the amplifiers. The extent of this increase will depending upon many variables, such as the protocol in question, the technique used, and the amplifying servers that actually produce the amplification in attack volume. Two prominent protocols that have enabled Reflection Amplification Floods are DNS and NTP, though the use of several others in the wild have been documented. In particular, the memcache protocol showed itself to be a powerful protocol, with amplification sizes up to 51,200 times the requesting packet.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Windows, IaaS, Linux, macOS

## What to Check

- [ ] Identify if Reflection Amplification technique is applicable to target environment
- [ ] Check Windows systems for indicators of Reflection Amplification
- [ ] Check IaaS systems for indicators of Reflection Amplification
- [ ] Check Linux systems for indicators of Reflection Amplification
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Reflection Amplification by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1498.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic
When flood volumes exceed the capacity of the network connection being targeted, it is typically necessary to intercept the incoming traffic upstream to filter out the attack traffic from the legitimate traffic. Such defenses can be provided by the hosting Internet Service Provider (ISP) or by a 3rd party such as a Content Delivery Network (CDN) or providers specializing in DoS mitigations.

Depending on flood volume, on-premises filtering may be possible by blocking source addresses sourcing the attack, blocking ports that are being targeted, or blocking protocols being used for transport.

As immediate response may require rapid engagement of 3rd parties, analyze the risk associated to critical resources being affected by Network DoS attacks and create a disaster recovery plan/business continuity plan to respond to incidents.


## Detection

### Detection Strategy for Reflection Amplification DoS (T1498.002)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Reflection Amplification technique applicable | Low | Impact |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Cisco DoSdetectNetflow](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/netflow/configuration/15-mt/nf-15-mt-book/nf-detct-analy-thrts.pdf)
- [Cloudflare DNSamplficationDoS](https://www.cloudflare.com/learning/ddos/dns-amplification-ddos-attack/)
- [Cloudflare NTPamplifciationDoS](https://www.cloudflare.com/learning/ddos/ntp-amplification-ddos-attack/)
- [Cloudflare ReflectionDoS May 2017](https://blog.cloudflare.com/reflections-on-reflections/)
- [Cloudflare Memcrashed Feb 2018](https://blog.cloudflare.com/memcrashed-major-amplification-attacks-from-port-11211/)
- [Arbor AnnualDoSreport Jan 2018](https://pages.arbornetworks.com/rs/082-KNA-087/images/13th_Worldwide_Infrastructure_Security_Report.pdf)
- [Atomic Red Team - T1498.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1498.002)
- [MITRE ATT&CK - T1498.002](https://attack.mitre.org/techniques/T1498/002)
