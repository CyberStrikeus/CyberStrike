---
name: "T1568.001_fast-flux-dns"
description: "Adversaries may use Fast Flux DNS to hide a command and control channel behind an array of rapidly changing IP addresses linked to a single domain resolution."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1568.001
  - command-and-control
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1568.001"
tactic: "command-and-control"
all_tactics:
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1568/001"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-300
chains_with:
  - T1568
  - T1568.002
  - T1568.003
prerequisites:
  - T1568
severity_boost:
  T1568: "Chain with T1568 for deeper attack path"
  T1568.002: "Chain with T1568.002 for deeper attack path"
  T1568.003: "Chain with T1568.003 for deeper attack path"
---

# T1568.001 Fast Flux DNS

> **Sub-technique of:** T1568

## High-Level Description

Adversaries may use Fast Flux DNS to hide a command and control channel behind an array of rapidly changing IP addresses linked to a single domain resolution. This technique uses a fully qualified domain name, with multiple IP addresses assigned to it which are swapped with high frequency, using a combination of round robin IP addressing and short Time-To-Live (TTL) for a DNS resource record.

The simplest, "single-flux" method, involves registering and de-registering an addresses as part of the DNS A (address) record list for a single DNS name. These registrations have a five-minute average lifespan, resulting in a constant shuffle of IP address resolution.

In contrast, the "double-flux" method registers and de-registers an address as part of the DNS Name Server record list for the DNS zone, providing additional resilience for the connection. With double-flux additional hosts can act as a proxy to the C2 host, further insulating the true source of the C2 channel.

## Kill Chain Phase

- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Fast Flux DNS technique is applicable to target environment
- [ ] Check Linux systems for indicators of Fast Flux DNS
- [ ] Check macOS systems for indicators of Fast Flux DNS
- [ ] Check Windows systems for indicators of Fast Flux DNS
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Fast Flux DNS by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1568.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Dynamic Resolution using Fast Flux DNS


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Fast Flux DNS technique applicable | Medium | Command And Control |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-300 | Channel Accessible by Non-Endpoint |


## References

- [MehtaFastFluxPt1](https://resources.infosecinstitute.com/fast-flux-networks-working-detection-part-1/#gref)
- [MehtaFastFluxPt2](https://resources.infosecinstitute.com/fast-flux-networks-working-detection-part-2/#gref)
- [Fast Flux - Welivesecurity](https://www.welivesecurity.com/2017/01/12/fast-flux-networks-work/)
- [Atomic Red Team - T1568.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1568.001)
- [MITRE ATT&CK - T1568.001](https://attack.mitre.org/techniques/T1568/001)
