---
name: "T1499.001_os-exhaustion-flood"
description: "Adversaries may launch a denial of service (DoS) attack targeting an endpoint's operating system (OS)."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1499.001
  - impact
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1499.001"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1499/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  - T1499
  - T1499.002
  - T1499.003
  - T1499.004
prerequisites:
  - T1499
severity_boost:
  T1499: "Chain with T1499 for deeper attack path"
  T1499.002: "Chain with T1499.002 for deeper attack path"
  T1499.003: "Chain with T1499.003 for deeper attack path"
---

# T1499.001 OS Exhaustion Flood

> **Sub-technique of:** T1499

## High-Level Description

Adversaries may launch a denial of service (DoS) attack targeting an endpoint's operating system (OS). A system's OS is responsible for managing the finite resources as well as preventing the entire system from being overwhelmed by excessive demands on its capacity. These attacks do not need to exhaust the actual resources on a system; the attacks may simply exhaust the limits and available resources that an OS self-imposes.

Different ways to achieve this exist, including TCP state-exhaustion attacks such as SYN floods and ACK floods. With SYN floods, excessive amounts of SYN packets are sent, but the 3-way TCP handshake is never completed. Because each OS has a maximum number of concurrent TCP connections that it will allow, this can quickly exhaust the ability of the system to receive new requests for TCP connections, thus preventing access to any TCP service provided by the server.

ACK floods leverage the stateful nature of the TCP protocol. A flood of ACK packets are sent to the target. This forces the OS to search its state table for a related TCP connection that has already been established. Because the ACK packets are for connections that do not exist, the OS will have to search the entire state table to confirm that no match exists. When it is necessary to do this for a large flood of packets, the computational requirements can cause the server to become sluggish and/or unresponsive, due to the work it must do to eliminate the rogue ACK packets. This greatly reduces the resources available for providing the targeted service.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if OS Exhaustion Flood technique is applicable to target environment
- [ ] Check Linux systems for indicators of OS Exhaustion Flood
- [ ] Check macOS systems for indicators of OS Exhaustion Flood
- [ ] Check Windows systems for indicators of OS Exhaustion Flood
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to OS Exhaustion Flood by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1499.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1037 Filter Network Traffic

Leverage services provided by Content Delivery Networks (CDN) or providers specializing in DoS mitigations to filter traffic upstream from services. Filter boundary traffic by blocking source addresses sourcing the attack, blocking ports that are being targeted, or blocking protocols being used for transport. To defend against SYN floods, enable SYN Cookies.

## Detection

### Endpoint DoS via OS Exhaustion Flood Detection Strategy

## Risk Assessment

| Finding                                  | Severity | Impact |
| ---------------------------------------- | -------- | ------ |
| OS Exhaustion Flood technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Cisco DoSdetectNetflow](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/netflow/configuration/15-mt/nf-15-mt-book/nf-detct-analy-thrts.pdf)
- [Cloudflare SynFlood](https://www.cloudflare.com/learning/ddos/syn-flood-ddos-attack/)
- [Corero SYN-ACKflood](https://web.archive.org/web/20220119104451/https://www.corero.com/resource-hub/syn-ack-flood-attack/)
- [Arbor AnnualDoSreport Jan 2018](https://pages.arbornetworks.com/rs/082-KNA-087/images/13th_Worldwide_Infrastructure_Security_Report.pdf)
- [Atomic Red Team - T1499.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1499.001)
- [MITRE ATT&CK - T1499.001](https://attack.mitre.org/techniques/T1499/001)
