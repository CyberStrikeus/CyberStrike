---
name: "T1499.002_service-exhaustion-flood"
description: "Adversaries may target the different network services provided by systems to conduct a denial of service (DoS)."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1499.002
  - impact
  - windows
  - iaas
  - linux
  - macos
  - sub-technique
technique_id: "T1499.002"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Windows
  - IaaS
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1499/002"
tech_stack:
  - windows
  - cloud
  - linux
  - macos
cwe_ids:
  - CWE-400
chains_with:
  - T1499
  - T1499.001
  - T1499.003
  - T1499.004
prerequisites:
  - T1499
severity_boost:
  T1499: "Chain with T1499 for deeper attack path"
  T1499.001: "Chain with T1499.001 for deeper attack path"
  T1499.003: "Chain with T1499.003 for deeper attack path"
---

# T1499.002 Service Exhaustion Flood

> **Sub-technique of:** T1499

## High-Level Description

Adversaries may target the different network services provided by systems to conduct a denial of service (DoS). Adversaries often target the availability of DNS and web services, however others have been targeted as well. Web server software can be attacked through a variety of means, some of which apply generally while others are specific to the software being used to provide the service.

One example of this type of attack is known as a simple HTTP flood, where an adversary sends a large number of HTTP requests to a web server to overwhelm it and/or an application that runs on top of it. This flood relies on raw volume to accomplish the objective, exhausting any of the various resources required by the victim software to provide the service.

Another variation, known as a SSL renegotiation attack, takes advantage of a protocol feature in SSL/TLS. The SSL/TLS protocol suite includes mechanisms for the client and server to agree on an encryption algorithm to use for subsequent secure connections. If SSL renegotiation is enabled, a request can be made for renegotiation of the crypto algorithm. In a renegotiation attack, the adversary establishes a SSL/TLS connection and then proceeds to make a series of renegotiation requests. Because the cryptographic renegotiation has a meaningful cost in computation cycles, this can cause an impact to the availability of the service when done in volume.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Windows, IaaS, Linux, macOS

## What to Check

- [ ] Identify if Service Exhaustion Flood technique is applicable to target environment
- [ ] Check Windows systems for indicators of Service Exhaustion Flood
- [ ] Check IaaS systems for indicators of Service Exhaustion Flood
- [ ] Check Linux systems for indicators of Service Exhaustion Flood
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Service Exhaustion Flood by examining the target platforms (Windows, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1499.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Leverage services provided by Content Delivery Networks (CDN) or providers specializing in DoS mitigations to filter traffic upstream from services. Filter boundary traffic by blocking source addresses sourcing the attack, blocking ports that are being targeted, or blocking protocols being used for transport.

## Detection

### Detection Strategy for Endpoint DoS via Service Exhaustion Flood

## Risk Assessment

| Finding                                       | Severity | Impact |
| --------------------------------------------- | -------- | ------ |
| Service Exhaustion Flood technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Arbor SSLDoS April 2012](https://www.netscout.com/blog/asert/ddos-attacks-ssl-something-old-something-new)
- [Cisco DoSdetectNetflow](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/netflow/configuration/15-mt/nf-15-mt-book/nf-detct-analy-thrts.pdf)
- [Cloudflare HTTPflood](https://www.cloudflare.com/learning/ddos/http-flood-ddos-attack/)
- [Arbor AnnualDoSreport Jan 2018](https://pages.arbornetworks.com/rs/082-KNA-087/images/13th_Worldwide_Infrastructure_Security_Report.pdf)
- [Atomic Red Team - T1499.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1499.002)
- [MITRE ATT&CK - T1499.002](https://attack.mitre.org/techniques/T1499/002)
